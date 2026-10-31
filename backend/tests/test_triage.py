import asyncio
import json
import time

from app import triage
from app.corridor import build_corridor
from app.findings import Finding
from app.simulator import Simulator
from app.triage import CognitiveTwin

RESULT = {
    "severity": "high",
    "summary": "Pier 4 strain and vibration rose together over 20 s; consistent with loss of stiffness.",
    "likely_causes": ["Cracking at pier base", "Sensor drift"],
    "evidence": ["Strain 3x baseline", "Vibration RMS above critical"],
    "recommended_actions": ["Restrict outer lane", "UAV audit of Pier 4 east face"],
    "visual_audit_needed": True,
    "visual_audit_target": "Pier 4, east face, lower third",
    "confidence": 0.7,
}


def _escalated_sim():
    sim = Simulator(build_corridor())
    for _ in range(5):
        sim.step()
    sim.inject_anomaly("B07.P4")
    sim._anomalies["B07.P4"] = time.time() - 60
    _, alerts = sim.step()
    sent = []

    async def capture(msg):
        sent.append(msg)

    sim.broadcast = capture
    return sim, [a for a in alerts if a.level == "critical"], sent


def _finding():
    return Finding(
        id="FD-0001", t=time.time(), asset_id="B07", component_id="B07.P4", concept="concrete crack",
        confidence=0.9, area_px=100, source="image", source_name="p4.jpg", bbox_uv=(0.1, 0.1, 0.2, 0.2),
        host_label="concrete pier #0", frames_tracked=None, thumbnail="data:image/jpeg;base64,AA",
    )


def test_context_includes_twin_state():
    sim, crit, _ = _escalated_sim()
    ctx = CognitiveTwin(sim, lambda: [_finding()]).context(crit[0])
    assert ctx["component"] == {"name": "Pier 4", "kind": "pier"}
    strain = next(s for s in ctx["component_sensors"] if s["sensor"] == "Strain")
    assert strain["status"] == "critical" and strain["critical_threshold"] == 450
    assert len(strain["trace_oldest_to_newest"]) == 6
    assert ctx["inspection_findings_on_component"][0]["defect"] == "concrete crack"
    assert set(ctx["environment"]) == {"Wind speed", "Air temperature"}
    json.dumps(ctx)  # must be serialisable for the request


def test_triage_streams_reasoning_and_parses_result(monkeypatch):
    sim, crit, sent = _escalated_sim()
    bodies = []

    async def fake_stream(path, body):
        bodies.append(body)
        yield {"type": "response.created"}
        for d in ["Strain tripled ", "while vibration rose."]:
            yield {"type": "response.reasoning_summary_text.delta", "delta": d}
        text = json.dumps(RESULT)
        for i in range(0, len(text), 40):
            yield {"type": "response.output_text.delta", "delta": text[i : i + 40]}
        yield {"type": "response.completed"}

    monkeypatch.setattr(triage.meta, "stream", fake_stream)
    tri = asyncio.run(CognitiveTwin(sim, lambda: []).run(crit[0]))

    assert tri.status == "done" and tri.result.severity == "high"
    assert tri.reasoning == "Strain tripled while vibration rose."
    assert bodies[0]["text"]["format"]["strict"] is True
    assert bodies[0]["reasoning"] == {"effort": "medium", "summary": "concise"}
    kinds = [m["type"] for m in sent]
    assert kinds == ["triage", "triage_delta", "triage_delta", "triage"]
    assert sent[0]["triage"]["status"] == "running" and sent[-1]["triage"]["status"] == "done"


def test_triage_error_is_reported(monkeypatch):
    sim, crit, _ = _escalated_sim()

    async def bad_stream(path, body):
        yield {"type": "response.output_text.delta", "delta": "{not json"}

    monkeypatch.setattr(triage.meta, "stream", bad_stream)
    tri = asyncio.run(CognitiveTwin(sim, lambda: []).run(crit[0]))
    assert tri.status == "error" and tri.result is None and "ValidationError" in tri.error


def test_auto_trigger_only_critical_with_cooldown(monkeypatch):
    sim, crit, _ = _escalated_sim()
    twin = CognitiveTwin(sim, lambda: [])
    runs = []

    async def fake_run(alert):
        runs.append(alert.id)
        twin._last_by_component[alert.component_id] = alert.t

    monkeypatch.setattr(triage.meta, "configured", True)
    monkeypatch.setattr(twin, "run", fake_run)
    for a in crit:  # strain + vibration on the same pier, same tick
        asyncio.run(twin.on_alert(a))
    watch = crit[0].model_copy(update={"level": "watch", "component_id": "B07.P2"})
    asyncio.run(twin.on_alert(watch))
    assert len(crit) == 2 and runs == [crit[0].id]
