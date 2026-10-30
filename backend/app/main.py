import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, TypeAdapter, ValidationError

from .config import settings
from .corridor import build_corridor
from .meta_client import MUSE_SPARK, MetaAPIError, meta
from .models import Asset
from .sam31 import DEFAULT_CONCEPTS, Concept, SegmentationReport, prepare_image, segment_image
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


MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_CONCEPTS = 16


@app.get("/api/inspect/vocabulary", response_model=list[Concept])
def inspect_vocabulary():
    return DEFAULT_CONCEPTS


@app.post("/api/inspect/segment", response_model=SegmentationReport)
async def inspect_segment(file: UploadFile, concepts: str | None = Form(None)):
    """Segment one inspection frame with SAM 3.1 against structural + defect vocabularies.

    `concepts` is an optional JSON list of {text, category}; defaults to DEFAULT_CONCEPTS.
    """
    if not meta.configured:
        raise HTTPException(503, "MODEL_API_KEY is not set")
    try:
        concept_list = (
            TypeAdapter(list[Concept]).validate_python(json.loads(concepts)) if concepts else DEFAULT_CONCEPTS
        )
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(400, f"Invalid concepts: {e}")
    if not 0 < len(concept_list) <= MAX_CONCEPTS:
        raise HTTPException(400, f"Provide 1-{MAX_CONCEPTS} concepts")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image larger than 20 MB")
    try:
        image_url, width, height = await asyncio.to_thread(prepare_image, data)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError):
        raise HTTPException(400, "Not a readable image")

    return await segment_image(image_url, width, height, concept_list)


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
