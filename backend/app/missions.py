"""Muse Wonder UAV re-scan missions.

Wonder holds the asset's full twin graph (components, occluders, health, target finding, latest
triage) and plans an inspection flight by calling the geometric planner as tools:
score_viewpoints (Algorithm 2) and plan_flight (collision-checked path). Its reasoning summary
streams to the UI; the final answer is a schema-constrained mission plan. Without an API key the
mission falls back to the planner's best viewpoint alone, and says so.
"""

import asyncio
import itertools
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .findings import Finding
from .meta_client import MUSE_WONDER, meta
from .models import Asset, Component
from .uav_planner import (
    CLEARANCE_M,
    MAX_INCIDENCE_DEG,
    MIN_ALTITUDE_M,
    FlightPath,
    Viewpoint,
    plan_flight,
    score_viewpoints,
)

MAX_TOOL_ROUNDS = 5
TOP_K = 6

INSTRUCTIONS = """You are the mission planner of a structural inspection digital twin. A UAV must re-image a
target region on a structural component, but pipes, scaffolding and neighbouring members may occlude
the camera. You have two tools backed by the twin's geometry engine:
- score_viewpoints: evaluates candidate camera poses (yaw/pitch offsets from the face normal at a standoff
  distance) by the fraction of the target region visible and viewing obliquity.
- plan_flight: builds a collision-checked flight path through chosen viewpoints and back to launch.
Use the tools to compare at least two standoff distances, then choose 1-2 viewpoints that maximise
coverage of the target with low incidence angle (sharper imagery for crack measurement). If one view
cannot cover the region, choose two complementary views. Always call plan_flight on your final choice.
Ground every number you report in tool results. Return the final mission as JSON."""

TOOLS = [
    {
        "type": "function",
        "name": "score_viewpoints",
        "description": "Score candidate UAV camera viewpoints for the mission target at a given standoff. "
        "Returns the square-on baseline and the best candidates with coverage (0-1), mean incidence (deg), "
        "quality, and which obstacles block the view.",
        "parameters": {
            "type": "object",
            "properties": {
                "standoff_m": {"type": "number", "description": "Camera distance from the surface, 3-12 m"},
                "max_yaw_deg": {"type": "number", "description": "Max yaw offset from the face normal, <= 75"},
                "max_pitch_deg": {"type": "number", "description": "Max pitch offset from the face normal, <= 60"},
            },
            "required": ["standoff_m", "max_yaw_deg", "max_pitch_deg"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "plan_flight",
        "description": "Plan a collision-checked flight from the launch point through the given viewpoints "
        "(ids from score_viewpoints) and back. Returns waypoints, length and detours.",
        "parameters": {
            "type": "object",
            "properties": {"viewpoint_ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["viewpoint_ids"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


class MissionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    chosen_viewpoint_ids: list[str]
    standoff_m: float
    expected_coverage: float
    gimbal_notes: str
    safety_notes: list[str]
    rationale: list[str]


class ToolCall(BaseModel):
    name: str
    args: dict
    summary: str


class Mission(BaseModel):
    id: str
    t: float
    asset_id: str
    component_id: str
    finding_id: str | None
    model: str
    status: Literal["running", "done", "error"]
    reasoning: str = ""
    tool_calls: list[ToolCall] = []
    baseline: Viewpoint | None = None
    candidates: list[Viewpoint] = []
    chosen: list[Viewpoint] = []
    path: FlightPath | None = None
    plan: MissionPlan | None = None
    note: str | None = None
    error: str | None = None
    ms: int | None = None


class MissionPlanner:
    def __init__(
        self,
        assets: dict[str, Asset],
        components: dict[str, Component],
        broadcast: Callable[[dict], Awaitable[None]],
        findings: Callable[[], list[Finding]],
        context_extra: Callable[[str], dict],
    ):
        self.assets = assets
        self.components = components
        self.broadcast = broadcast
        self.findings = findings
        self.context_extra = context_extra  # component_id -> {health, latest triage}
        self.missions: deque[Mission] = deque(maxlen=20)
        self._ids = itertools.count(1)
        self._tasks: set[asyncio.Task] = set()

    # --- tools --------------------------------------------------------------

    def _target(self, m: Mission):
        comp = self.components[m.component_id]
        f = next((x for x in self.findings() if x.id == m.finding_id), None)
        return self.assets[m.asset_id], comp, (f.bbox_uv if f else None)

    def _remember(self, m: Mission, vps: list[Viewpoint]) -> None:
        known = {v.id for v in m.candidates}
        m.candidates += [v for v in vps if v.id not in known]

    def tool_score(self, m: Mission, standoff_m: float, max_yaw_deg: float, max_pitch_deg: float) -> dict:
        asset, comp, uv = self._target(m)
        standoff = min(max(standoff_m, 3.0), 12.0)
        baseline, cands = score_viewpoints(
            asset, comp, uv, standoff_m=standoff, max_yaw_deg=min(max_yaw_deg, 75), max_pitch_deg=min(max_pitch_deg, 60)
        )
        m.baseline = m.baseline or baseline
        self._remember(m, cands[:TOP_K])
        return {
            "standoff_m": standoff,
            "baseline": baseline.model_dump(include={"coverage", "mean_incidence_deg", "blocked_by"}),
            "candidates": [
                v.model_dump(include={"id", "yaw_deg", "pitch_deg", "coverage", "mean_incidence_deg", "quality", "blocked_by"})
                for v in cands[:TOP_K]
            ],
            "evaluated": len(cands),
        }

    def tool_flight(self, m: Mission, viewpoint_ids: list[str]) -> dict:
        by_id = {v.id: v for v in m.candidates}
        unknown = [i for i in viewpoint_ids if i not in by_id]
        if unknown or not viewpoint_ids:
            return {"error": f"unknown viewpoint ids {unknown}; call score_viewpoints first and use its ids"}
        fp = plan_flight(self.assets[m.asset_id], [by_id[i] for i in viewpoint_ids])
        return fp.model_dump()

    def _exec(self, m: Mission, name: str, args: dict) -> tuple[dict, str]:
        if name == "score_viewpoints":
            out = self.tool_score(m, float(args.get("standoff_m", 6)), float(args.get("max_yaw_deg", 60)), float(args.get("max_pitch_deg", 40)))
            best = out["candidates"][0] if out["candidates"] else None
            summary = (
                f"standoff {out['standoff_m']:g} m: baseline {out['baseline']['coverage']:.0%}"
                + (f" → best {best['id']} {best['coverage']:.0%}" if best else " → no feasible pose")
            )
            return out, summary
        if name == "plan_flight":
            out = self.tool_flight(m, list(args.get("viewpoint_ids", [])))
            summary = out.get("error") or f"{len(out['waypoints'])} waypoints, {out['length_m']} m, {out['detours']} detour(s)"
            return out, summary
        return {"error": f"unknown tool {name}"}, f"unknown tool {name}"

    # --- mission ------------------------------------------------------------

    def context(self, m: Mission) -> dict:
        asset, comp, uv = self._target(m)
        f = next((x for x in self.findings() if x.id == m.finding_id), None)
        return {
            "target": {
                "component": comp.name,
                "kind": comp.kind,
                "face": "front (+z)",
                "region_uv": uv,
                "finding": f.model_dump(exclude={"thumbnail"}) if f else None,
            },
            "asset": {"name": asset.name, "type": asset.type, "description": asset.description},
            "twin_graph": {
                "components": [
                    {"id": c.id, "name": c.name, "kind": c.kind, "geometry": c.geometry.model_dump() if c.geometry else None}
                    for c in asset.components
                ],
                "occluders": [o.model_dump() for o in asset.occluders],
                "frame": "asset-local metres, y up, structure front faces +z",
            },
            "constraints": {
                "uav_home": asset.uav_home,
                "clearance_m": CLEARANCE_M,
                "min_altitude_m": MIN_ALTITUDE_M,
                "max_incidence_deg": MAX_INCIDENCE_DEG,
            },
            **self.context_extra(comp.id),
        }

    def start(self, component_id: str, finding_id: str | None) -> Mission:
        comp = self.components[component_id]
        m = Mission(
            id=f"MS-{next(self._ids):04d}",
            t=time.time(),
            asset_id=comp.asset_id,
            component_id=component_id,
            finding_id=finding_id,
            model=MUSE_WONDER,
            status="running",
        )
        self.missions.append(m)
        task = asyncio.create_task(self.run(m))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return m

    async def _publish(self, m: Mission) -> None:
        await self.broadcast({"type": "mission", "mission": m.model_dump()})

    async def run(self, m: Mission) -> Mission:
        t0 = time.perf_counter()
        await self._publish(m)
        try:
            # Deterministic first pass: the twin always has a geometric answer, with or without Wonder.
            await asyncio.to_thread(self.tool_score, m, 6.0, 60.0, 40.0)
            if not meta.configured:
                m.note = "Muse Wonder unavailable (no MODEL_API_KEY): showing Algorithm 2's best viewpoint only."
                m.chosen = m.candidates[:1]
            else:
                await self._wonder(m)
            if m.chosen:
                m.path = await asyncio.to_thread(plan_flight, self.assets[m.asset_id], m.chosen)
            m.status = "done"
        except Exception as e:
            m.status, m.error = "error", f"{type(e).__name__}: {e}"[:500]
        m.ms = int((time.perf_counter() - t0) * 1000)
        await self._publish(m)
        return m

    async def _wonder(self, m: Mission) -> None:
        schema = MissionPlan.model_json_schema()
        base = {
            "model": MUSE_WONDER,
            "instructions": INSTRUCTIONS,
            "tools": TOOLS,
            "reasoning": {"effort": "medium", "summary": "concise"},
            "text": {"format": {"type": "json_schema", "name": "uav_mission", "schema": schema, "strict": True}},
        }
        body = {**base, "input": json.dumps(self.context(m))}
        for _ in range(MAX_TOOL_ROUNDS + 1):
            response_id, calls, text = None, [], []
            async for ev in meta.stream("/responses", body):
                kind = ev.get("type")
                if kind in ("response.created", "response.completed"):
                    response_id = ev.get("response", {}).get("id") or response_id
                elif kind == "response.reasoning_summary_text.delta":
                    m.reasoning += ev.get("delta", "")
                    await self.broadcast({"type": "mission_delta", "id": m.id, "delta": ev.get("delta", "")})
                elif kind == "response.output_item.done" and ev.get("item", {}).get("type") == "function_call":
                    calls.append(ev["item"])
                elif kind == "response.output_text.delta":
                    text.append(ev.get("delta", ""))
                elif kind == "response.failed":
                    raise RuntimeError(json.dumps(ev.get("response", {}).get("error")) or "response.failed")
            if not calls:
                m.plan = MissionPlan.model_validate_json("".join(text))
                by_id = {v.id: v for v in m.candidates}
                m.chosen = [by_id[i] for i in m.plan.chosen_viewpoint_ids if i in by_id] or m.candidates[:1]
                return
            outputs = []
            for call in calls:
                try:
                    args = json.loads(call.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result, summary = await asyncio.to_thread(self._exec, m, call.get("name", ""), args)
                m.tool_calls.append(ToolCall(name=call.get("name", ""), args=args, summary=summary))
                outputs.append({"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result)})
            await self._publish(m)
            body = {**base, "previous_response_id": response_id, "input": outputs}
        raise RuntimeError(f"Wonder did not finish within {MAX_TOOL_ROUNDS} tool rounds")

    def snapshot(self) -> list[dict]:
        return [m.model_dump() for m in self.missions]
