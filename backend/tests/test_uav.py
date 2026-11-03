import asyncio
import json
import time

import numpy as np

from app import missions as missions_mod
from app.corridor import build_corridor
from app.findings import Finding
from app.missions import MissionPlanner
from app.models import Geometry, Occluder
from app.uav_planner import Box, plan_flight, score_viewpoints, segments_hit

ASSET = build_corridor()[0]
COMPS = {c.id: c for c in ASSET.components}
BEHIND_PIPE = (0.4, 0.55, 0.6, 0.75)


def test_slab_test():
    box = Box("b", "b", np.array([0.0, 0, 0]), np.array([1.0, 1, 1]))
    a = np.array([[-1.0, 0.5, 0.5], [-1.0, 2.0, 0.5], [0.5, 0.5, 0.5]])
    b = np.array([[2.0, 0.5, 0.5], [2.0, 2.0, 0.5], [0.5, 0.5, 3.0]])
    assert segments_hit(a, b, box).tolist() == [True, False, True]
    assert not segments_hit(np.array([[-2.0, 0.5, 0.5]]), np.array([[-1.0, 0.5, 0.5]]), box)[0]  # stops short


def test_pipe_blocks_baseline_and_adaptation_recovers_view():
    baseline, cands = score_viewpoints(ASSET, COMPS["B07.P4"], BEHIND_PIPE, standoff_m=6)
    assert baseline.coverage <= 0.4 and "Drainage downpipe" in baseline.blocked_by
    best = cands[0]
    assert best.coverage >= 0.85 and abs(best.yaw_deg) > 0
    assert best.mean_incidence_deg < 45


def test_unobstructed_pier_is_fine_square_on():
    baseline, cands = score_viewpoints(ASSET, COMPS["B07.P2"], BEHIND_PIPE, standoff_m=6)
    assert baseline.coverage == 1.0 and baseline.blocked_by == []


def test_flight_path_detours_around_obstacle():
    wall = Occluder(id="X", name="wall", kind="test", geometry=Geometry(shape="box", position=(20, 5, 18), size=(30, 10, 1)))
    asset = ASSET.model_copy(update={"occluders": ASSET.occluders + [wall]})
    _, cands = score_viewpoints(asset, COMPS["B07.P4"], BEHIND_PIPE, standoff_m=6)
    fp = plan_flight(asset, cands[:1])
    assert fp.detours >= 1 and fp.waypoints[0] == fp.waypoints[-1] == asset.uav_home


def _planner(sent):
    finding = Finding(
        id="FD-0001", t=time.time(), asset_id="B07", component_id="B07.P4", concept="concrete crack", confidence=0.9,
        area_px=100, source="image", source_name="p4.jpg", bbox_uv=BEHIND_PIPE, host_label=None, frames_tracked=None,
        thumbnail="data:image/jpeg;base64,AA",
    )

    async def broadcast(msg):
        sent.append(msg)

    return MissionPlanner({"B07": ASSET}, COMPS, broadcast, lambda: [finding], lambda cid: {"latest_triage": None})


def test_wonder_tool_loop(monkeypatch):
    sent, bodies, chosen = [], [], []
    rounds = iter(["score", "flight", "final"])

    async def fake_stream(path, body):
        bodies.append(json.loads(json.dumps(body)))  # snapshot: the loop keeps appending to the same history
        step = next(rounds)
        yield {"type": "response.created", "response": {"id": f"resp_{len(bodies)}"}}
        yield {"type": "response.reasoning_summary_text.delta", "delta": f"[{step}] "}
        if step == "score":
            for i, so in enumerate((4, 8)):
                yield {"type": "response.output_item.done", "item": {"type": "function_call", "call_id": f"c{i}", "name": "score_viewpoints", "arguments": json.dumps({"standoff_m": so, "max_yaw_deg": 60, "max_pitch_deg": 40})}}
        elif step == "flight":
            scored = [json.loads(i["output"]) for i in body["input"] if i["type"] == "function_call_output"]
            chosen.append(scored[-1]["candidates"][0]["id"])  # pick the best pose the tool returned
            yield {"type": "response.output_item.done", "item": {"type": "function_call", "call_id": "c9", "name": "plan_flight", "arguments": json.dumps({"viewpoint_ids": chosen})}}
        else:
            plan = {"summary": "Fly left of the downpipe.", "chosen_viewpoint_ids": chosen, "standoff_m": 8, "expected_coverage": 0.9,
                    "gimbal_notes": "Yaw -30°.", "safety_notes": ["Keep 1 m from scaffold"], "rationale": ["Baseline blocked by pipe"]}
            yield {"type": "response.output_text.delta", "delta": json.dumps(plan)}
        yield {"type": "response.completed", "response": {"id": f"resp_{len(bodies)}"}}

    monkeypatch.setattr(missions_mod.meta, "configured", True)
    monkeypatch.setattr(missions_mod.meta, "stream", fake_stream)

    async def go():
        p = _planner(sent)
        m = p.start("B07.P4", "FD-0001")
        await asyncio.gather(*p._tasks)
        return m

    m = asyncio.run(go())
    assert m.status == "done", m.error
    assert [t.name for t in m.tool_calls] == ["score_viewpoints", "score_viewpoints", "plan_flight"]
    # Stateless loop: each turn resends input + function calls + outputs, call ids paired in order.
    turn2 = bodies[1]["input"]
    assert turn2[0]["type"] == "message" and "previous_response_id" not in bodies[1]
    assert [(i["type"], i["call_id"]) for i in turn2[1:]] == [("function_call", "c0"), ("function_call_output", "c0"), ("function_call", "c1"), ("function_call_output", "c1")]
    assert len(bodies[2]["input"]) == 7 and bodies[2]["store"] is False
    assert bodies[0]["tools"][0]["name"] == "score_viewpoints" and "instructions" in bodies[2]
    assert [v.id for v in m.chosen] == chosen and m.chosen[0].coverage >= 0.85 and m.path and m.path.length_m > 0
    assert m.reasoning == "[score] [flight] [final] "
    assert m.baseline.coverage <= 0.4


def test_mission_context_has_no_image_payloads():
    p = _planner([])
    f = p.findings()[0].model_copy(update={"mask_png": "data:image/png;base64,QUFB", "thumbnail_mask_png": "data:image/png;base64,QUFB"})
    p.findings = lambda: [f]
    m = missions_mod.Mission(id="MS-1", t=0, asset_id="B07", component_id="B07.P4", finding_id=f.id, model="x", status="running")
    ctx = json.dumps(p.context(m))
    assert "data:image" not in ctx and "concrete crack" in ctx


def test_mission_without_key_uses_algorithm_only(monkeypatch):
    monkeypatch.setattr(missions_mod.meta, "configured", False)
    sent = []

    async def go():
        p = _planner(sent)
        m = p.start("B07.P4", "FD-0001")
        await asyncio.gather(*p._tasks)
        return m

    m = asyncio.run(go())
    assert m.status == "done" and m.plan is None and "unavailable" in m.note
    assert m.chosen and m.chosen[0].coverage >= 0.85 and m.path is not None
    assert sent[0]["mission"]["status"] == "running" and sent[-1]["mission"]["status"] == "done"
