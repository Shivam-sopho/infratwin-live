"""Cognitive Twin: Muse Spark triage of structural alerts.

When a sensor crosses a critical threshold, the twin assembles everything it knows about
the affected component (geometry role, live sensor traces, neighbouring sensor states,
recent alerts, pinned inspection findings) and asks Muse Spark for a structured
engineering assessment. The model's reasoning summary streams to the UI as it thinks.
"""

import asyncio
import itertools
import json
import time
from collections import deque
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .findings import Finding
from .meta_client import MUSE_SPARK, meta
from .models import Alert
from .simulator import Simulator

COOLDOWN_S = 120.0  # one triage per component per window (strain + vibration alerts arrive together)
TRACE_TICKS = 120  # last ~60 s at 2 Hz
TRACE_POINTS = 30

INSTRUCTIONS = """You are the reasoning core of a structural health monitoring digital twin for civil
infrastructure (bridges, tunnels, dams). You receive one alert plus the twin's context for the affected
component. Assess it as an experienced bridge/structures engineer would:
- Ground every claim in the provided data (sensor traces, thresholds, other sensors, findings). Do not invent
  measurements. If the evidence is thin, say so and lower your confidence.
- Distinguish structural causes (cracking, bearing seizure, scour, loss of section) from sensor or
  environmental causes (sensor drift, temperature, traffic overload).
- Recommend concrete, prioritised actions (e.g. restrict lanes, deploy UAV visual audit of a named face,
  verify sensor, schedule hands-on inspection).
- Set visual_audit_needed when a camera/drone inspection would discriminate between the likely causes, and
  name the exact target (component + face/region).
Keep each list item to one sentence."""


class TriageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Literal["low", "moderate", "high", "critical"]
    summary: str
    likely_causes: list[str]
    evidence: list[str]
    recommended_actions: list[str]
    visual_audit_needed: bool
    visual_audit_target: str
    confidence: float


class Triage(BaseModel):
    id: str
    t: float
    alert_id: str
    asset_id: str
    component_id: str
    model: str
    status: Literal["running", "done", "error"]
    reasoning: str = ""
    result: TriageResult | None = None
    error: str | None = None
    ms: int | None = None


def _text_format() -> dict:
    return {"type": "json_schema", "name": "structural_triage", "schema": TriageResult.model_json_schema(), "strict": True}


class CognitiveTwin:
    def __init__(self, sim: Simulator, findings: Callable[[], list[Finding]], auto: bool = True):
        self.sim = sim
        self.findings = findings
        self.auto = auto
        self.triages: deque[Triage] = deque(maxlen=30)
        self._ids = itertools.count(1)
        self._last_by_component: dict[str, float] = {}
        self._tasks: set[asyncio.Task] = set()

    # --- context ------------------------------------------------------------

    def context(self, alert: Alert) -> dict:
        sim = self.sim
        comp = sim.components[alert.component_id]
        asset = sim.assets[comp.asset_id]
        recent = list(sim.history)[-TRACE_TICKS:]
        step = max(1, len(recent) // TRACE_POINTS)
        sample = recent[::step]

        def trace(sid: str) -> list[float]:
            return [round(r[sid], 3) for _, r in sample if sid in r]

        sensors = []
        for sid in comp.sensor_ids:
            s = sim.sensors[sid]
            sensors.append(
                {
                    "sensor": s.label,
                    "unit": s.unit,
                    "baseline": s.baseline,
                    "watch_threshold": s.watch,
                    "critical_threshold": s.critical,
                    "status": sim.sensor_status[sid],
                    "trace_oldest_to_newest": trace(sid),
                    "trace_interval_s": round(step / 2, 1),
                }
            )
        comp_status = sim.status()["components"]
        others = [
            {"component": c.name, "status": comp_status[c.id]}
            for c in asset.components
            if c.id != comp.id and comp_status[c.id] != "nominal"
        ]
        latest = sim.history[-1][1] if sim.history else {}
        return {
            "alert": {"level": alert.level, "message": alert.message, "t_unix": round(alert.t)},
            "asset": {"name": asset.name, "type": asset.type, "description": asset.description},
            "component": {"name": comp.name, "kind": comp.kind},
            "component_sensors": sensors,
            "other_components_not_nominal": others,
            "environment": {
                sim.sensors[sid].label: f"{latest[sid]:.1f} {sim.sensors[sid].unit}"
                for c in asset.components
                if c.kind == "environment"
                for sid in c.sensor_ids
                if sid in latest
            },
            "recent_alerts_on_asset": [a.message for a in sim.alerts if a.asset_id == asset.id][-8:],
            "inspection_findings_on_component": [
                {
                    "defect": f.concept,
                    "confidence": f.confidence,
                    "on_element": f.host_label,
                    "source": f.source,
                    "age_min": round((time.time() - f.t) / 60, 1),
                    "metrology": f.metrology.model_dump(exclude={"assumptions"}, exclude_none=True) if f.metrology else None,
                }
                for f in self.findings()
                if f.component_id == comp.id
            ],
        }

    # --- triage -------------------------------------------------------------

    async def on_alert(self, alert: Alert) -> None:
        if not (self.auto and meta.configured and alert.level == "critical"):
            return
        last = self._last_by_component.get(alert.component_id)
        if last is not None and alert.t - last < COOLDOWN_S:
            return
        await self.run(alert)

    def start(self, alert: Alert) -> None:
        """Run a triage in the background; progress arrives over the telemetry WebSocket."""
        task = asyncio.create_task(self.run(alert))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def run(self, alert: Alert) -> Triage:
        self._last_by_component[alert.component_id] = alert.t
        comp = self.sim.components[alert.component_id]
        tri = Triage(
            id=f"TR-{next(self._ids):04d}",
            t=time.time(),
            alert_id=alert.id,
            asset_id=comp.asset_id,
            component_id=comp.id,
            model=MUSE_SPARK,
            status="running",
        )
        self.triages.append(tri)
        await self._publish(tri)

        body = {
            "model": MUSE_SPARK,
            "instructions": INSTRUCTIONS,
            "input": json.dumps(self.context(alert)),
            "reasoning": {"effort": "medium", "summary": "concise"},
            "text": {"format": _text_format()},
            "store": False,
        }
        t0 = time.perf_counter()
        text: list[str] = []
        try:
            async for ev in meta.stream("/responses", body):
                kind = ev.get("type")
                if kind == "response.reasoning_summary_text.delta":
                    tri.reasoning += ev.get("delta", "")
                    await self.sim.broadcast({"type": "triage_delta", "id": tri.id, "delta": ev.get("delta", "")})
                elif kind == "response.output_text.delta":
                    text.append(ev.get("delta", ""))
                elif kind == "response.failed":
                    raise RuntimeError(json.dumps(ev.get("response", {}).get("error")) or "response.failed")
            tri.result = TriageResult.model_validate_json("".join(text))
            tri.status = "done"
        except Exception as e:
            tri.status, tri.error = "error", f"{type(e).__name__}: {e}"[:500]
        tri.ms = int((time.perf_counter() - t0) * 1000)
        await self._publish(tri)
        return tri

    async def _publish(self, tri: Triage) -> None:
        await self.sim.broadcast({"type": "triage", "triage": tri.model_dump()})

    def snapshot(self) -> list[dict]:
        return [t.model_dump() for t in self.triages]


def find_alert(sim: Simulator, alert_id: str) -> Alert | None:
    return next((a for a in sim.alerts if a.id == alert_id), None)
