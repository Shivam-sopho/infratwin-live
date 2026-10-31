"""Clients for self-hosted / third-party-hosted open-weight Muse models (OpenAI-compatible chat API)."""

import httpx

from .config import settings


class OpenWeightError(RuntimeError):
    pass


class ChatClient:
    def __init__(self, label: str, base_url: str, api_key: str, model: str):
        self.label, self.model = label, model
        self.configured = bool(base_url and model)
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
            timeout=httpx.Timeout(120.0, connect=10.0),
        )

    async def chat(self, messages: list[dict], **extra) -> dict:
        """POST /chat/completions; returns the first choice's message."""
        if not self.configured:
            raise OpenWeightError(f"{self.label} is not configured")
        r = await self._http.post("/chat/completions", json={"model": self.model, "messages": messages, **extra})
        if r.status_code >= 400:
            raise OpenWeightError(f"{self.label} {r.status_code}: {r.text[:500]}")
        return r.json()["choices"][0]["message"]

    async def aclose(self) -> None:
        await self._http.aclose()


glimmer = ChatClient("Muse Glimmer", settings.glimmer_base_url, settings.glimmer_api_key, settings.glimmer_model)
spark_open = ChatClient("Muse Spark Open", settings.spark_open_base_url, settings.spark_open_api_key, settings.spark_open_model)
