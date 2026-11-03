"""Thin async client for the Meta Model API (https://dev.meta.ai/docs).

Feature modules (SAM 3.1 segmentation, Muse Image, Voice Transcribe, Wonder planner)
build on this rather than talking HTTP directly.
"""

import asyncio
import base64
import json
from collections.abc import AsyncIterator

import httpx

from .config import settings

MUSE_SPARK = "muse-spark-1.3"
MUSE_WONDER = "muse-wonder-1.0"
MUSE_IMAGE = "muse-image-1.0"
MUSE_VOICE = "muse-voice-transcribe-1.0"
SAM_31 = "sam-3.1"


RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_DELAYS_S = (1.0, 3.0)  # up to 3 attempts in total


class MetaAPIError(RuntimeError):
    pass


class MetaClient:
    def __init__(self, api_key: str, base_url: str):
        self.configured = bool(api_key)
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    async def _post(self, path: str, **kw) -> httpx.Response:
        """POST with retries on transient overload / server errors (429, 5xx) and connection drops."""
        for attempt, delay in enumerate((*RETRY_DELAYS_S, None)):
            try:
                r = await self._http.post(path, **kw)
            except httpx.TransportError:
                if delay is None:
                    raise
            else:
                if r.status_code not in RETRY_STATUS or delay is None:
                    return r
            await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    async def respond(self, model: str, input: str | list, **extra) -> dict:
        """POST /responses (non-streaming)."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        r = await self._post("/responses", json={"model": model, "input": input, **extra})
        if r.status_code >= 400:
            raise MetaAPIError(f"{r.status_code}: {r.text[:500]}")
        return r.json()

    async def stream(self, path: str, body: dict) -> AsyncIterator[dict]:
        """POST with `stream: true` and yield each server-sent event's JSON payload."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        for delay in (*RETRY_DELAYS_S, None):
            async with self._http.stream(
                "POST", path, json={**body, "stream": True}, headers={"Accept": "text/event-stream"}
            ) as r:
                if r.status_code in RETRY_STATUS and delay is not None:
                    await r.aread()
                    await asyncio.sleep(delay)
                    continue  # retry only before any event has been yielded
                if r.status_code >= 400:
                    raise MetaAPIError(f"{r.status_code}: {(await r.aread()).decode(errors='replace')[:500]}")
                async for line in r.aiter_lines():
                    if line.startswith("data:"):
                        data = line[5:].strip()
                        if data and data != "[DONE]":
                            yield json.loads(data)
                return

    async def upload_file(self, path: str, filename: str, content_type: str, purpose: str = "user_data") -> str:
        """POST /files; returns the file id."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        with open(path, "rb") as f:
            content = f.read()
        r = await self._post("/files", files={"file": (filename, content, content_type)}, data={"purpose": purpose}, timeout=300)
        if r.status_code >= 400:
            raise MetaAPIError(f"{r.status_code}: {r.text[:500]}")
        return r.json()["id"]

    async def transcribe(self, wav: bytes, settings: dict) -> dict:
        """POST /asr/transcribe (multipart: `request` JSON + `audio` WAV); returns TranscribeResponse."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        r = await self._post(
            "/asr/transcribe",
            files={
                "request": (None, json.dumps(settings), "application/json"),
                "audio": ("audio.wav", wav, "audio/wav"),
            },
            headers={"Accept": "application/json"},
        )
        if r.status_code >= 400:
            raise MetaAPIError(f"{r.status_code}: {r.text[:500]}")
        return r.json()

    async def image_edit(self, prompt: str, image_url: str, output_format: str = "jpeg") -> bytes:
        """POST /images/edits with one input image (data URL); returns the edited image bytes."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        r = await self._post(
            "/images/edits",
            json={
                "model": MUSE_IMAGE,
                "prompt": prompt,
                "images": [{"image_url": image_url}],
                "response_format": "b64_json",
                "output_format": output_format,
            },
            timeout=180,
        )
        if r.status_code >= 400:
            raise MetaAPIError(f"{r.status_code}: {r.text[:500]}")
        return base64.b64decode(r.json()["data"][0]["b64_json"])

    async def delete_file(self, file_id: str) -> None:
        await self._http.delete(f"/files/{file_id}")

    @staticmethod
    def output_text(response: dict) -> str:
        parts = [
            c.get("text", "")
            for item in response.get("output", [])
            if item.get("type") == "message"
            for c in item.get("content", [])
            if c.get("type") == "output_text"
        ]
        return "".join(parts)

    async def aclose(self) -> None:
        await self._http.aclose()


meta = MetaClient(settings.model_api_key, settings.meta_api_base)
