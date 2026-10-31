import asyncio
import json
import time

from app import screening
from app.corridor import build_corridor
from app.screening import Screener
from app.simulator import Simulator


def _sim_with_alert():
    sim = Simulator(build_corridor())
    for _ in range(10):
        sim.step()
    sim.inject_anomaly("B07.P4")
    sim._anomalies["B07.P4"] = time.time() - 60
    _, alerts = sim.step()
    sent = []

    async def capture(msg):
        sent.append(msg)

    sim.broadcast = capture
    return sim, alerts[0], sent


def test_glimmer_screen_published(monkeypatch):
    sim, alert, sent = _sim_with_alert()
    seen = {}

    async def fake_chat(messages, **kw):
        seen["input"] = json.loads(messages[1]["content"])
        seen["kw"] = kw
        return {"content": 'Sure: {"verdict": "structural", "escalate": true, "reason": "Strain and vibration rose together."}'}

    monkeypatch.setattr(screening.glimmer, "configured", True)
    monkeypatch.setattr(screening.glimmer, "model", "muse-glimmer-test")
    monkeypatch.setattr(screening.glimmer, "chat", fake_chat)
    asyncio.run(Screener(sim).on_alert(alert))

    assert sent[0]["type"] == "screen"
    sc = sent[0]["screen"]
    assert sc["verdict"] == "structural" and sc["escalate"] is True and sc["alert_id"] == alert.id
    assert seen["input"]["sensor"]["trace"] and seen["input"]["same_component"]
    assert seen["kw"]["temperature"] == 0


def test_glimmer_unconfigured_or_garbage_is_silent(monkeypatch):
    sim, alert, sent = _sim_with_alert()
    monkeypatch.setattr(screening.glimmer, "configured", False)
    asyncio.run(Screener(sim).on_alert(alert))

    async def garbage(messages, **kw):
        return {"content": "no json here"}

    monkeypatch.setattr(screening.glimmer, "configured", True)
    monkeypatch.setattr(screening.glimmer, "chat", garbage)
    asyncio.run(Screener(sim).on_alert(alert))
    assert sent == []
