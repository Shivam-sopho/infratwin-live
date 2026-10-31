import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.budget import Budget, BudgetExceeded


@pytest.fixture
def locked(monkeypatch):
    monkeypatch.setattr(main.settings, "app_access_token", "s3cret-token")
    return TestClient(main.app)


def test_open_when_no_token_configured(monkeypatch):
    monkeypatch.setattr(main.settings, "app_access_token", "")
    c = TestClient(main.app)
    assert c.get("/api/assets").status_code == 200
    with c.websocket_connect("/ws/telemetry") as ws:
        assert ws.receive_json()["type"] == "snapshot"


def test_token_required_for_api_and_socket(locked):
    c = locked
    assert c.get("/api/health").status_code == 200  # health stays open for probes
    assert c.get("/api/health").json()["auth_required"] is True
    assert c.get("/api/assets").status_code == 401
    assert c.get("/api/auth/status").json() == {"required": True, "authenticated": False}
    with c.websocket_connect("/ws/telemetry") as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401

    assert c.post("/api/auth/login", json={"token": "wrong"}).status_code == 401
    assert c.get("/api/assets", headers={"Authorization": "Bearer s3cret-token"}).status_code == 200  # machine client

    r = c.post("/api/auth/login", json={"token": "s3cret-token"})
    assert r.status_code == 200 and "httponly" in r.headers["set-cookie"].lower()
    assert c.get("/api/assets").status_code == 200  # cookie now set on the client
    assert c.get("/api/auth/status").json()["authenticated"] is True
    with c.websocket_connect("/ws/telemetry") as ws:
        assert ws.receive_json()["type"] == "snapshot"
    c.post("/api/auth/logout")
    c.cookies.clear()
    assert c.get("/api/assets").status_code == 401


def test_budget_cap_and_persistence(tmp_path):
    b = Budget(tmp_path / "b.json", cap_usd=0.05)
    b.charge("x", 0.03)
    with pytest.raises(BudgetExceeded):
        b.charge("x", 0.03)
    assert Budget(tmp_path / "b.json", cap_usd=0.05).status()["spent_usd"] == 0.03  # survives restart


def test_budget_exceeded_returns_429(monkeypatch, isolated_budget):
    monkeypatch.setattr(main.meta, "configured", True)
    monkeypatch.setattr(isolated_budget, "cap", 0.001)
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 64)).save(buf, "JPEG")
    r = TestClient(main.app).post("/api/inspect/segment", files={"file": ("a.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 429 and "budget" in r.json()["detail"].lower()
