import time

from app.corridor import build_corridor
from app.simulator import Simulator, _classify


def test_classify_hysteresis():
    sim = Simulator(build_corridor())
    s = sim.sensors["B07.P4.strain"]  # watch 320, critical 450
    assert _classify(s, 200, "nominal") == "nominal"
    assert _classify(s, 330, "nominal") == "watch"
    assert _classify(s, 460, "watch") == "critical"
    assert _classify(s, 440, "critical") == "critical"  # within 5% margin, holds
    assert _classify(s, 200, "critical") == "nominal"


def test_anomaly_escalates_to_critical_and_alerts():
    sim = Simulator(build_corridor())
    sim.inject_anomaly("B07.P4")
    sim._anomalies["B07.P4"] = time.time() - 60  # ramp fully applied
    _, alerts = sim.step()
    status = sim.status()
    assert status["components"]["B07.P4"] == "critical"
    assert status["assets"]["B07"] == "critical"
    assert status["components"]["B07.P3"] != "critical"
    assert any(a.component_id == "B07.P4" and a.level == "critical" for a in alerts)


def test_demo_reset_endpoint(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    sent = []

    async def capture(msg):
        sent.append(msg)

    monkeypatch.setattr(main.sim, "broadcast", capture)
    main.sim.inject_anomaly("B07.P4")
    main.sim._anomalies["B07.P4"] = time.time() - 60
    main.sim.step()
    assert main.sim.alerts and main.sim.status()["components"]["B07.P4"] == "critical"

    assert TestClient(main.app).post("/api/demo/reset").json() == {"ok": True}
    assert not main.sim.alerts and not main.sim._anomalies and not main.twin.triages
    assert main.sim.status()["assets"]["B07"] == "nominal"
    assert sent[-1]["type"] == "snapshot" and sent[-1]["alerts"] == []


def test_samples_only_serve_manifest_files(tmp_path, monkeypatch):
    import json as _json

    from fastapi.testclient import TestClient

    from app import main

    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "a.jpg").write_bytes(b"\xff\xd8jpeg")
    (tmp_path / "secret.txt").write_text("nope")
    (tmp_path / "manifest.json").write_text(_json.dumps({"source": "test", "themes": {"crack": [{"file": "data/a.jpg", "labels": ["Crack"], "boxes": []}]}}))
    monkeypatch.setattr(main, "SAMPLES_DIR", tmp_path)
    c = TestClient(main.app)
    items = c.get("/api/samples").json()["items"]
    assert [i["name"] for i in items] == ["a.jpg"] and items[0]["theme"] == "crack"
    assert c.get("/api/samples/a.jpg").content == b"\xff\xd8jpeg"
    assert c.get("/api/samples/secret.txt").status_code == 404
    assert c.get("/api/samples/..%2Fsecret.txt").status_code == 404
