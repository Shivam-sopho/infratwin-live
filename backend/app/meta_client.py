"""Thin async client for the Meta Model API (https://dev.meta.ai/docs).

Feature modules (SAM 3.1 segmentation, Muse Image, Voice Transcribe, Wonder planner)
build on this rather than talking HTTP directly.
"""

import httpx

from .config import settings

MUSE_SPARK = "muse-spark-1.3"
MUSE_WONDER = "muse-wonder-1.0"
MUSE_IMAGE = "muse-image-1.0"
MUSE_VOICE = "muse-voice-transcribe-1.0"
SAM_31 = "sam-3.1"


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

    async def respond(self, model: str, input: str | list, **extra) -> dict:
        """POST /responses (non-streaming)."""
        if not self.configured:
            raise MetaAPIError("MODEL_API_KEY is not set")
        r = await self._http.post("/responses", json={"model": model, "input": input, **extra})
        if r.status_code >= 400:
            raise MetaAPIError(f"{r.status_code}: {r.text[:500]}")
        return r.json()

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
