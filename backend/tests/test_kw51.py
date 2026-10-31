from datetime import datetime, timezone

import numpy as np
from fastapi.testclient import TestClient

from app import kw51, main
from app.corridor import build_corridor
from app.simulator import Simulator

ENV_LABELS = ["tBD31A", "rhBD31A", "tVL", "rhVL", "vpVL", "grVL", "drVL", "dnrVL", "raVL", "wsVL", "wdVL"]


def _synthetic():
    """KW51-shaped data: temperature + frozen-ballast effects, then a +2 % stiffening at the retrofit end."""
    rng = np.random.default_rng(0)
    t0 = datetime(2018, 10, 1, tzinfo=timezone.utc).timestamp()
    n = 24 * 470
    t = t0 + 3600 * np.arange(n)
    sdn = t / 86400 + 719529
    T = 10 + 12 * np.sin(2 * np.pi * np.arange(n) / (24 * 365)) + 4 * np.sin(2 * np.pi * np.arange(n) / 24)
    after = t > kw51.RETROFIT_END.timestamp()
    f = np.full((n, 14), np.nan)
    for m in kw51.MODES:
        base = {3: 1.89, 6: 2.93, 9: 4.11, 13: 6.37}[m]
        f[:, m - 1] = base - 0.001 * T - 0.02 * np.minimum(T, 0) + rng.normal(0, 0.004, n) + after * 0.02 * base * (m != 3)
    f[100:110, 5] = np.nan  # tracking gap
    env = np.zeros((n, 11))
    env[:, 0], env[:, 2], env[:, 3], env[:, 9] = T, T - 1, 80, 3
    return kw51.build(sdn, f, env, ENV_LABELS)


def test_compensated_model_separates_temperature_from_stiffness_change():
    d = _synthetic()
    pre = d.t < kw51.RETROFIT_START.timestamp()
    post = d.t > kw51.RETROFIT_END.timestamp() + 86400
    for m in (6, 9, 13):
        c = d.models[m].coef
        assert abs(c[1] + 0.001) < 5e-4 and abs(c[2] + 0.02) < 5e-3  # recovers temperature + frozen-ballast terms
        assert np.nanmean(np.abs(d.z[m][pre]) > 5) < 0.01  # temperature swings alone don't alarm
        assert np.nanmean(np.abs(d.z[m][post]) > 5) > 0.9  # the stiffness change does
    assert np.nanmean(np.abs(d.z[3][post]) > 5) < 0.01  # unaffected mode stays quiet


def test_replay_clock_seek_and_readings():
    d = _synthetic()
    rp = kw51.Replay(d, hours_per_s=24)
    rp.advance(2.0)
    assert rp.row == 48 and rp.phase() == "pre-retrofit"
    rp.seek(kw51.RETROFIT_END)
    rp.advance(24 * 3600 / 24 * 10 / 3600)  # 10 h of data
    assert rp.phase() == "post-retrofit"
    r = rp.readings()
    assert set(r) >= {"mode6_hz", "mode6_dev", "steel_temp", "wind"} and r["mode6_dev"] > 3
    rp.playing = False
    row = rp.row
    rp.advance(100)
    assert rp.row == row


def test_simulator_uses_replay_holds_gaps_and_ingest_overrides():
    d = _synthetic()
    sim = Simulator(build_corridor(include_kw51=True), replays={"KW51": kw51.Replay(d, hours_per_s=3600)})
    sim.replays["KW51"].pos = 99.0
    sim.step()
    first = sim.history[-1][1]["KW51.DECK.mode6_hz"]
    assert abs(first - d.freq[6][99]) < 1e-3
    sim.replays["KW51"].pos = 104.0  # inside the tracking gap
    sim.replays["KW51"].playing = False
    sim.step()
    assert sim.history[-1][1]["KW51.DECK.mode6_hz"] == first  # held through the gap

    assert sim.ingest({"B07.P4.strain": 999.0, "NOPE": 1.0}) == ["NOPE"]
    _, alerts = sim.step()
    assert sim.history[-1][1]["B07.P4.strain"] == 999.0
    assert sim.status()["components"]["B07.P4"] == "critical"


def test_replay_and_ingest_endpoints(monkeypatch):
    sim = Simulator(build_corridor(include_kw51=True), replays={"KW51": kw51.Replay(_synthetic())})
    monkeypatch.setattr(main, "sim", sim)
    c = TestClient(main.app)
    s = c.post("/api/replay/KW51", json={"seek": "retrofit", "hours_per_s": 48, "playing": False}).json()
    assert s["phase"] == "retrofit works" and s["hours_per_s"] == 48 and s["playing"] is False
    assert c.post("/api/replay/KW51", json={"seek": "not-a-date"}).status_code == 400
    assert c.post("/api/replay/B07", json={}).status_code == 404
    r = c.post("/api/ingest", json={"readings": {"B07.P1.strain": 200.5, "X.Y": 1}}).json()
    assert r == {"accepted": 1, "unknown": ["X.Y"]}
