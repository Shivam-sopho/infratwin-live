import asyncio

import httpx

from app import meta_client
from app.meta_client import MetaClient


def _client(handler, monkeypatch):
    monkeypatch.setattr(meta_client, "RETRY_DELAYS_S", (0.0, 0.0))
    c = MetaClient("k", "https://api.test/v1")
    c._http = httpx.AsyncClient(base_url="https://api.test/v1", transport=httpx.MockTransport(handler))
    return c


def test_respond_retries_transient_overload(monkeypatch):
    calls = []

    def handler(req):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503, json={"error": {"code": "service_overloaded"}})
        return httpx.Response(200, json={"output": []})

    c = _client(handler, monkeypatch)
    assert asyncio.run(c.respond("m", "hi")) == {"output": []} and len(calls) == 3


def test_stream_retries_before_first_event_and_gives_up(monkeypatch):
    calls = []

    def handler(req):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, text="slow down")
        return httpx.Response(200, text='data: {"type": "response.completed"}\n\n', headers={"content-type": "text/event-stream"})

    c = _client(handler, monkeypatch)

    async def collect():
        return [e async for e in c.stream("/responses", {"model": "m"})]

    assert asyncio.run(collect()) == [{"type": "response.completed"}] and len(calls) == 2

    def always_down(req):
        return httpx.Response(503, text="down")

    c2 = _client(always_down, monkeypatch)
    try:
        asyncio.run(c2.respond("m", "hi"))
        raise AssertionError("should raise")
    except meta_client.MetaAPIError as e:
        assert "503" in str(e)
