import asyncio
import json
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import av
from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, TypeAdapter, ValidationError

from .config import settings
from .corridor import build_corridor
from .findings import Finding, FindingIn, FindingStore
from .metrology import ScaleRef, scale_ref_for
from .meta_client import MUSE_SPARK, MetaAPIError, meta
from .models import Asset
from .sam31 import DEFAULT_CONCEPTS, Concept, SegmentationReport, prepare_image, segment_image
from .sam31_video import VideoReport, segment_video, transcode
from .simulator import Simulator
from .triage import CognitiveTwin, find_alert

ASSETS = build_corridor()
sim = Simulator(ASSETS)
findings = FindingStore(Path(__file__).resolve().parent.parent / "data" / "findings.json")
ASSET_OF_COMPONENT = {c.id: a.id for a in ASSETS for c in a.components}
twin = CognitiveTwin(sim, lambda: findings.all(), auto=settings.triage_auto)
sim.alert_listeners.append(twin.on_alert)


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


MAX_VIDEO_BYTES = 300 * 1024 * 1024


def _scale_ref(component_id: str | None) -> ScaleRef | None:
    if not component_id:
        return None
    if component_id not in sim.components:
        raise HTTPException(404, f"Unknown component {component_id}")
    return scale_ref_for(sim.components[component_id])


def _parse_concepts(concepts: str | None) -> list[Concept]:
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
    return concept_list


@app.get("/api/inspect/vocabulary", response_model=list[Concept])
def inspect_vocabulary():
    return DEFAULT_CONCEPTS


@app.post("/api/inspect/segment", response_model=SegmentationReport)
async def inspect_segment(file: UploadFile, concepts: str | None = Form(None), component_id: str | None = Form(None)):
    """Segment one inspection frame with SAM 3.1 against structural + defect vocabularies.

    `concepts` is an optional JSON list of {text, category}; defaults to DEFAULT_CONCEPTS.
    `component_id` (where the frame was captured) enables metric defect measurement.
    """
    concept_list = _parse_concepts(concepts)
    scale_ref = _scale_ref(component_id)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image larger than 20 MB")
    try:
        image_url, width, height = await asyncio.to_thread(prepare_image, data)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError):
        raise HTTPException(400, "Not a readable image")

    return await segment_image(image_url, width, height, concept_list, scale_ref)


@app.post("/api/inspect/segment-video", response_model=VideoReport)
async def inspect_segment_video(
    file: UploadFile, concepts: str | None = Form(None), component_id: str | None = Form(None)
):
    """Track structural elements + defects through a clip with SAM 3.1 (resampled to 5 fps, max 20 s)."""
    concept_list = _parse_concepts(concepts)
    scale_ref = _scale_ref(component_id)
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in"), os.path.join(tmp, "clip.mp4")
        size = 0
        with open(src, "wb") as f:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_VIDEO_BYTES:
                    raise HTTPException(413, "Video larger than 300 MB")
                f.write(chunk)
        try:
            video = await asyncio.to_thread(transcode, src, dst)
        except (ValueError, av.FFmpegError, IndexError) as e:
            raise HTTPException(400, f"Not a readable video: {e}")
        try:
            return await segment_video(dst, video, concept_list, scale_ref)
        except MetaAPIError as e:
            raise HTTPException(502, str(e))


@app.get("/api/findings", response_model=list[Finding])
def list_findings():
    return findings.all()


@app.post("/api/findings", response_model=list[Finding])
async def add_findings(items: list[FindingIn]):
    unknown = {i.component_id for i in items} - ASSET_OF_COMPONENT.keys()
    if unknown:
        raise HTTPException(404, f"Unknown component(s): {sorted(unknown)}")
    added = findings.add(items, ASSET_OF_COMPONENT)
    await sim.broadcast({"type": "findings", "added": [f.model_dump() for f in added], "removed": []})
    return added


@app.delete("/api/findings/{finding_id}")
async def delete_finding(finding_id: str):
    if not findings.remove(finding_id):
        raise HTTPException(404, f"Unknown finding {finding_id}")
    await sim.broadcast({"type": "findings", "added": [], "removed": [finding_id]})
    return {"ok": True}


class TriageRequest(BaseModel):
    alert_id: str


@app.post("/api/triage")
async def triage_alert(req: TriageRequest):
    """Manually ask the Cognitive Twin to assess an alert (bypasses the auto-trigger cooldown)."""
    if not meta.configured:
        raise HTTPException(503, "MODEL_API_KEY is not set")
    alert = find_alert(sim, req.alert_id)
    if alert is None:
        raise HTTPException(404, f"Unknown alert {req.alert_id}")
    twin.start(alert)
    return {"ok": True}


@app.websocket("/ws/telemetry")
async def telemetry(ws: WebSocket):
    await ws.accept()
    await ws.send_json(
        {**sim.snapshot(), "findings": [f.model_dump() for f in findings.all()], "triages": twin.snapshot()}
    )
    sim.clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim.clients.discard(ws)
