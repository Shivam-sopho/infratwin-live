"""Shared-token access control for the API and telemetry socket.

Disabled when APP_ACCESS_TOKEN is unset (local development). Browsers log in once and get an
HttpOnly cookie, so fetches, <img> loads and the WebSocket are all covered; machine clients
(sensor gateways) send `Authorization: Bearer <token>`.
"""

import hmac

from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .config import settings

COOKIE = "infratwin_session"
OPEN_PATHS = {"/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/status"}


def enabled() -> bool:
    return bool(settings.app_access_token)


def valid(token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(token.encode(), settings.app_access_token.encode())


def _token_from(headers, cookies) -> str | None:
    auth = headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return cookies.get(COOKIE)


def request_allowed(request: Request) -> bool:
    if not enabled() or not request.url.path.startswith("/api/") or request.url.path in OPEN_PATHS:
        return True
    return valid(_token_from(request.headers, request.cookies))


def websocket_allowed(ws: WebSocket) -> bool:
    return not enabled() or valid(_token_from(ws.headers, ws.cookies))


async def middleware(request: Request, call_next):
    if not request_allowed(request):
        return JSONResponse({"detail": "Authentication required"}, status_code=401)
    return await call_next(request)


class LoginRequest(BaseModel):
    token: str
