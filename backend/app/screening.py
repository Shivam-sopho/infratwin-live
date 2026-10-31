"""Muse Glimmer first-pass screening of every non-nominal alert.

Glimmer (30B, open weights, self-hosted) is cheap and fast enough to look at every watch/critical
crossing: it classifies the likely nature of the anomaly from the component's recent trace and its
neighbours, and decides whether to escalate. Muse Spark's full triage still runs on critical alerts.
"""

import json
import time
from collections import deque
from typing import Literal

from pydantic import BaseModel, ValidationError

from .models import Alert
from .openweight import OpenWeightError, glimmer
from .simulator import Simulator

TRACE_POINTS = 12

PROMPT = """You screen structural health monitoring alerts for a bridge/tunnel/dam digital twin. Given one alert,
the sensor's recent trace (oldest→newest) with thresholds, and the other sensors on the same component, classify
the likely nature of the anomaly. Reply with JSON only:
{"verdict": "structural" | "sensor_fault" | "environmental" | "uncertain", "escalate": true|false, "reason": "<one sentence>"}
A sudden step or flat-line on one sensor while correlated sensors are calm suggests sensor_fault; correlated
rises on several sensors of one component suggest structural; matching weather/traffic swings suggest environmental."""


class Screen(BaseModel):
    alert_id: str
    t: float
    model: str
    verdict: Literal["structural", "sensor_fault", "environmental", "uncertain"]
    escalate: bool
    reason: str
    ms: int


class Screener:
    def __init__(self, sim: Simulator):
        self.sim = sim
        self.screens: deque[Screen] = deque(maxlen=50)

    def prompt_input(self, alert: Alert) -> dict:
        sim = self.sim
        s = sim.sensors[alert.sensor_id]
        recent = list(sim.history)[-60:]
        step = max(1, len(recent) // TRACE_POINTS)
        comp = sim.components[alert.component_id]
        return {
            "alert": alert.message,
            "sensor": {"label": s.label, "unit": s.unit, "baseline": s.baseline, "watch": s.watch, "critical": s.critical,
                       "trace": [round(r[s.id], 3) for _, r in recent[::step] if s.id in r]},
            "same_component": {
                sim.sensors[o].label: {"status": sim.sensor_status[o], "trace": [round(r[o], 3) for _, r in recent[::step] if o in r]}
                for o in comp.sensor_ids
                if o != s.id
            },
        }

    async def on_alert(self, alert: Alert) -> None:
        if not glimmer.configured:
            return
        t0 = time.perf_counter()
        try:
            msg = await glimmer.chat(
                [{"role": "system", "content": PROMPT}, {"role": "user", "content": json.dumps(self.prompt_input(alert))}],
                temperature=0,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            raw = msg.get("content") or ""
            data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
            screen = Screen(
                alert_id=alert.id, t=time.time(), model=glimmer.model, verdict=data["verdict"],
                escalate=bool(data["escalate"]), reason=str(data["reason"])[:300], ms=int((time.perf_counter() - t0) * 1000),
            )
        except (OpenWeightError, ValueError, KeyError, ValidationError) as e:
            print(f"Glimmer screening failed for {alert.id}: {e}")
            return
        self.screens.append(screen)
        await self.sim.broadcast({"type": "screen", "screen": screen.model_dump()})

    def snapshot(self) -> list[dict]:
        return [s.model_dump() for s in self.screens]
