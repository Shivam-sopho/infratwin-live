import json

import pytest
from fastapi.testclient import TestClient

from app import forecast as forecast_mod
from app import main
from app.findings import FindingStore
from app.forecast import ForecastStore

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main.meta, "configured", True)
    monkeypatch.setattr(main, "findings", FindingStore(tmp_path / "findings.json"))
    monkeypatch.setattr(main, "forecasts", ForecastStore(tmp_path / "forecasts"))
    f = main.findings.add(
        [main.FindingIn(component_id="B07.P4", concept="concrete crack", confidence=0.9, area_px=10, source="image",
                        source_name="p4.jpg", bbox_uv=(0.4, 0.5, 0.6, 0.7), thumbnail="data:image/jpeg;base64,AAAA")],
        main.ASSET_OF_COMPONENT,
    )[0]
    calls = {"respond": [], "edit": []}

    async def fake_respond(model, input, **kw):
        calls["respond"].append({"model": model, "input": json.loads(input), **kw})
        plan = {"narrative": "Water ingress widens the crack.", "image_prompt": "Widen the crack to ~1 mm with rust staining."}
        return {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(plan)}]}]}

    async def fake_edit(prompt, image_url, output_format="jpeg"):
        calls["edit"].append((prompt, image_url))
        return JPEG

    monkeypatch.setattr(forecast_mod.meta, "respond", fake_respond)
    monkeypatch.setattr(forecast_mod.meta, "image_edit", fake_edit)
    return TestClient(main.app), f, calls


def test_reason_then_render_and_cache(client):
    c, f, calls = client
    r = c.post(f"/api/findings/{f.id}/forecasts", json={"scenario": "2y"})
    assert r.status_code == 200, r.text
    fc = r.json()
    assert fc["narrative"].startswith("Water") and fc["models"] == ["muse-spark-1.3", "muse-image-1.0"]
    assert calls["edit"] == [("Widen the crack to ~1 mm with rust staining.", "data:image/jpeg;base64,AAAA")]
    ctx = calls["respond"][0]["input"]
    assert "2 years" in ctx["scenario"] and ctx["host_component"]["name"] == "Pier 4" and "thumbnail" not in ctx["finding"]
    assert calls["respond"][0]["text"]["format"]["strict"] is True

    img = c.get(fc["image_url"])
    assert img.status_code == 200 and img.content == JPEG and img.headers["content-type"] == "image/jpeg"

    # Second request is served from cache: no new model calls.
    assert c.post(f"/api/findings/{f.id}/forecasts", json={"scenario": "2y"}).status_code == 200
    assert len(calls["respond"]) == 1 and len(calls["edit"]) == 1
    assert [x["scenario"] for x in c.get(f"/api/findings/{f.id}/forecasts").json()] == ["2y"]


def test_forecast_validation(client):
    c, f, _ = client
    assert c.post(f"/api/findings/{f.id}/forecasts", json={"scenario": "10y"}).status_code == 422
    assert c.post("/api/findings/FD-9999/forecasts", json={"scenario": "2y"}).status_code == 404
    assert c.get(f"/api/findings/{f.id}/forecasts/repair.jpg").status_code == 404
