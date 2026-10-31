import asyncio
import base64
import io
import json

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main, sam3d
from app.findings import FindingStore
from app.sam3d import LiftStore, full_frame_mask, geofence


def _png(mask: np.ndarray) -> str:
    alpha = Image.fromarray(mask.astype(np.uint8) * 255, "L")
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    buf = io.BytesIO()
    rgba.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _points(n=100) -> str:
    pts = np.random.default_rng(0).random((n, 6), dtype=np.float32)
    return base64.b64encode(pts.tobytes()).decode()


def test_geofence_verdicts():
    defect = [0.0, -2.0, 6.0]  # 2 m above the camera axis, 6 m out
    people = [
        {"cam_t": [1.0, 1.0, 6.5]},  # below, ~1.1 m horizontally -> inside
        {"cam_t": [4.0, 1.0, 6.0]},  # below but 4 m away -> clear
        {"cam_t": [0.5, -3.0, 6.0]},  # above the defect -> clear
        {"cam_t": None},
    ]
    rep = geofence(defect, people, 3.0)
    assert [w.verdict for w in rep.workers] == ["inside_exclusion", "clear", "clear", "unknown"]
    assert rep.any_violation and rep.workers[0].horizontal_distance_m == 1.12
    assert geofence(None, people[:1], 3.0).workers[0].verdict == "unknown"


def test_full_frame_mask_placement():
    local = np.ones((10, 20), bool)
    png = full_frame_mask(100, 50, (30, 5, 50, 15), _png(local))
    full = np.asarray(Image.open(io.BytesIO(png))) > 0
    assert full.shape == (50, 100) and full.sum() == 200 and full[5:15, 30:50].all()


def test_post_sends_proxy_auth(monkeypatch):
    seen = {}

    def handler(request):
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"people": []})

    real = httpx.AsyncClient
    monkeypatch.setattr(sam3d.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(sam3d.settings, "sam3d_body_url", "https://ws--sam3d-localize-workers.modal.run")
    monkeypatch.setattr(sam3d.settings, "modal_proxy_key", "wk-123")
    monkeypatch.setattr(sam3d.settings, "modal_proxy_secret", "ws-456")
    asyncio.run(sam3d.localize_people(b"\xff\xd8jpeg"))
    assert seen["headers"]["modal-key"] == "wk-123" and seen["headers"]["modal-secret"] == "ws-456"
    assert base64.b64decode(seen["body"]["image_b64"]) == b"\xff\xd8jpeg"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "findings", FindingStore(tmp_path / "findings.json"))
    monkeypatch.setattr(main, "lifts", LiftStore(tmp_path / "lifts"))
    monkeypatch.setattr(sam3d.settings, "sam3d_objects_url", "https://objects")
    monkeypatch.setattr(sam3d.settings, "sam3d_body_url", "https://body")
    sent = []

    async def capture(msg):
        sent.append(msg)

    monkeypatch.setattr(main.sim, "broadcast", capture)
    return TestClient(main.app), sent


def test_lift_endpoint(client, monkeypatch):
    c, sent = client
    mask = _png(np.ones((8, 8), bool))
    f = main.findings.add(
        [main.FindingIn(component_id="B07.P4", concept="concrete spalling", area_px=64, source="image", source_name="p.jpg",
                        bbox_uv=(0.1, 0.1, 0.2, 0.2), thumbnail="data:image/jpeg;base64,AAAA", thumbnail_mask_png=mask)],
        main.ASSET_OF_COMPONENT,
    )[0]
    got = {}

    async def fake_reconstruct(image, mask_png, max_points=40000):
        got["args"] = (image, mask_png)
        return {"points_b64": _points(100), "n": 100, "rotation": [1, 0, 0, 0], "translation": [0.1, -0.2, 2.5], "scale": [0.3], "keys": ["gs"]}

    monkeypatch.setattr(sam3d, "reconstruct", fake_reconstruct)
    r = c.post(f"/api/findings/{f.id}/lift")
    assert r.status_code == 200, r.text
    lift = r.json()
    assert lift["n_points"] == 100 and lift["translation"] == [0.1, -0.2, 2.5] and got["args"][1] == mask
    pts = c.get(lift["points_url"])
    assert len(pts.content) == 100 * 6 * 4
    assert sent[0]["type"] == "lift"


def test_workzone_endpoint(client, monkeypatch):
    c, _ = client
    img = Image.new("RGB", (400, 300), (128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    calls = {}

    async def fake_reconstruct(image, mask_png, max_points=40000):
        calls["mask"] = np.asarray(Image.open(io.BytesIO(mask_png))) > 0
        return {"points_b64": _points(10), "translation": [0.0, -2.0, 6.0]}

    async def fake_people(image):
        return {"people": [{"cam_t": [1.0, 1.0, 6.5], "bbox": [10, 20, 60, 200]}]}

    monkeypatch.setattr(sam3d, "reconstruct", fake_reconstruct)
    monkeypatch.setattr(sam3d, "localize_people", fake_people)
    r = c.post(
        "/api/inspect/workzone",
        files={"file": ("f.jpg", buf.getvalue(), "image/jpeg")},
        data={"defect_bounds": json.dumps([100, 50, 140, 70]), "defect_mask_png": _png(np.ones((20, 40), bool)), "radius_m": "3"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["any_violation"] is True
    assert calls["mask"].shape == (300, 400) and calls["mask"].sum() == 800
    assert c.post("/api/inspect/workzone", files={"file": ("f.jpg", buf.getvalue(), "image/jpeg")},
                  data={"defect_bounds": "nope", "defect_mask_png": "x"}).status_code == 400
