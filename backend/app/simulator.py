"""Live structural-health telemetry simulator + health roll-up + WebSocket fan-out.

Stands in for the IoT ingestion path (Muse Connectors) until real feeds are wired.
"""

import asyncio
import itertools
import math
import random
import time
from collections import deque

from fastapi import WebSocket

from .config import settings
from .corridor import ENVIRONMENTAL_KINDS
from .models import STATUS_RANK, Alert, Asset, Sensor, Status

HISTORY_TICKS = 240
ANOMALY_RAMP_S = 20.0
DOWNGRADE_MARGIN = 0.95  # hysteresis: must fall 5% below a threshold to clear it
SCRIPTED_ANOMALY_COMPONENT = "B07.P4"


def _classify(s: Sensor, v: float, prev: Status) -> Status:
    level: Status = "critical" if v >= s.critical else "watch" if v >= s.watch else "nominal"
    if STATUS_RANK[level] < STATUS_RANK[prev]:
        threshold = s.critical if prev == "critical" else s.watch
        if v > threshold * DOWNGRADE_MARGIN:
            return prev
    return level


def _worst(statuses) -> Status:
    return max(statuses, key=STATUS_RANK.__getitem__, default="nominal")


class Simulator:
    def __init__(self, assets: list[Asset]):
        self.assets = {a.id: a for a in assets}
        self.components = {c.id: c for a in assets for c in a.components}
        self.sensors = {s.id: s for a in assets for s in a.sensors}
        self._phase = {sid: random.uniform(0, 2 * math.pi) for sid in self.sensors}
        self._period = {sid: random.uniform(20, 60) for sid in self.sensors}
        self._anomalies: dict[str, float] = {}  # component_id -> injection time
        self._alert_ids = itertools.count(1)
        self._auto_fired = False

        self.t0 = time.time()
        self.sensor_status: dict[str, Status] = {sid: "nominal" for sid in self.sensors}
        self.history: deque[tuple[float, dict[str, float]]] = deque(maxlen=HISTORY_TICKS)
        self.alerts: deque[Alert] = deque(maxlen=50)
        self.clients: set[WebSocket] = set()

    # --- control -----------------------------------------------------------

    def inject_anomaly(self, component_id: str) -> None:
        self._anomalies[component_id] = time.time()

    def reset(self) -> None:
        self._anomalies.clear()

    # --- sampling ----------------------------------------------------------

    def _sample(self, s: Sensor, t: float) -> float:
        base = s.baseline
        v = base * (1 + 0.06 * math.sin(2 * math.pi * t / self._period[s.id] + self._phase[s.id]))
        v += random.gauss(0, base * 0.015)
        start = self._anomalies.get(s.component_id)
        if start is not None and s.kind not in ENVIRONMENTAL_KINDS:
            ramp = min((t - start) / ANOMALY_RAMP_S, 1.0)
            ramp = ramp * ramp * (3 - 2 * ramp)  # smoothstep
            v += (s.critical * 1.12 - base) * ramp
        return max(v, 0.0)

    def step(self) -> tuple[dict, list[Alert]]:
        t = time.time()
        if settings.sim_auto_anomaly_s and not self._auto_fired and t - self.t0 >= settings.sim_auto_anomaly_s:
            self._auto_fired = True
            self.inject_anomaly(SCRIPTED_ANOMALY_COMPONENT)

        readings = {sid: round(self._sample(s, t), 3) for sid, s in self.sensors.items()}
        self.history.append((t, readings))

        new_alerts: list[Alert] = []
        for sid, v in readings.items():
            s = self.sensors[sid]
            prev = self.sensor_status[sid]
            cur = _classify(s, v, prev)
            self.sensor_status[sid] = cur
            if STATUS_RANK[cur] > STATUS_RANK[prev]:
                new_alerts.append(self._make_alert(s, v, cur, t))
        self.alerts.extend(new_alerts)

        return {"type": "tick", "t": t, "readings": readings, "status": self.status()}, new_alerts

    def _make_alert(self, s: Sensor, v: float, level: Status, t: float) -> Alert:
        comp = self.components[s.component_id]
        threshold = s.critical if level == "critical" else s.watch
        return Alert(
            id=f"AL-{next(self._alert_ids):04d}",
            t=t,
            level=level,
            asset_id=comp.asset_id,
            component_id=comp.id,
            sensor_id=s.id,
            value=v,
            message=f"{comp.name} · {s.label} {v:.2f} {s.unit} ≥ {level} threshold {threshold:g} {s.unit}",
        )

    def status(self) -> dict:
        comp_status = {
            cid: _worst(self.sensor_status[sid] for sid in c.sensor_ids) for cid, c in self.components.items()
        }
        asset_status = {
            aid: _worst(comp_status[c.id] for c in a.components) for aid, a in self.assets.items()
        }
        return {"sensors": self.sensor_status, "components": comp_status, "assets": asset_status}

    # --- fan-out -----------------------------------------------------------

    def snapshot(self) -> dict:
        return {
            "type": "snapshot",
            "history": [{"t": t, "readings": r} for t, r in self.history],
            "alerts": [a.model_dump() for a in self.alerts],
            "status": self.status(),
        }

    async def _broadcast(self, msg: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                self.clients.discard(ws)

    async def run(self) -> None:
        interval = 1.0 / settings.sim_tick_hz
        while True:
            tick, new_alerts = self.step()
            await self._broadcast(tick)
            for alert in new_alerts:
                # Hook point for Muse Glimmer / Spark anomaly triage.
                await self._broadcast({"type": "alert", "alert": alert.model_dump()})
            await asyncio.sleep(interval)
