import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import settings
from .corridor import build_corridor
from .meta_client import MUSE_SPARK, MetaAPIError, meta
from .models import Asset
from .simulator import Simulator

ASSETS = build_corridor()
sim = Simulator(ASSETS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(sim.run())
    yield
    task.cancel()
    await meta.aclose()


app = FastAPI(title="InfraTwin-Live API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "meta_api_configured": meta.configured, "ws_clients": len(sim.clients)}


@app.get("/api/assets", response_model=list[Asset])
def list_assets():
    return ASSETS


class AnomalyRequest(BaseModel):
    component_id: str


@app.post("/api/sim/anomaly")
def inject_anomaly(req: AnomalyRequest):
    if req.component_id not in sim.components:
        raise HTTPException(404, f"Unknown component {req.component_id}")
    sim.inject_anomaly(req.component_id)
    return {"ok": True}


@app.post("/api/sim/reset")
def reset_sim():
    sim.reset()
    return {"ok": True}


@app.get("/api/meta/ping")
async def meta_ping():
    """One tiny Muse Spark call to confirm the API key and connectivity."""
    try:
        resp = await meta.respond(MUSE_SPARK, "Reply with exactly: InfraTwin online")
    except MetaAPIError as e:
        raise HTTPException(502, str(e))
    return {"model": MUSE_SPARK, "text": meta.output_text(resp)}


@app.websocket("/ws/telemetry")
async def telemetry(ws: WebSocket):
    await ws.accept()
    await ws.send_json(sim.snapshot())
    sim.clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim.clients.discard(ws)
