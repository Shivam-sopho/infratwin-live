import asyncio
import json
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import av
from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, TypeAdapter, ValidationError

from .config import settings
from .corridor import build_corridor
from .findings import Finding, FindingIn, FindingStore
from .forecast import Forecast, ForecastStore, Scenario, render as render_forecast
from .metrology import ScaleRef, scale_ref_for
from .missions import MissionPlanner
from .meta_client import MUSE_SPARK, MetaAPIError, meta
from .models import Asset
from .sam31 import DEFAULT_CONCEPTS, Concept, SegmentationReport, prepare_image, segment_image
from .sam31_video import VideoReport, segment_video, transcode
from .simulator import Simulator
from .triage import CognitiveTwin, find_alert
from .voice import ActionResult, NoteStore, VoiceResult, check_wav, interpret, transcribe, vocabulary

ASSETS = build_corridor()
sim = Simulator(ASSETS)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
findings = FindingStore(DATA_DIR / "findings.json")
notes = NoteStore(DATA_DIR / "notes.json")
forecasts = ForecastStore(DATA_DIR / "forecasts")
ASSET_OF_COMPONENT = {c.id: a.id for a in ASSETS for c in a.components}
twin = CognitiveTwin(sim, lambda: findings.all(), auto=settings.triage_auto)
sim.alert_listeners.append(twin.on_alert)


def _mission_context(component_id: str) -> dict:
    latest = next((t for t in reversed(twin.triages) if t.component_id == component_id and t.result), None)
    comp = sim.components[component_id]
    return {
        "component_health": {sim.sensors[s].label: sim.sensor_status[s] for s in comp.sensor_ids},
        "latest_triage": latest.result.model_dump() if latest else None,
    }


planner = MissionPlanner(
    {a.id: a for a in ASSETS},
    sim.components,
    lambda msg: sim.broadcast(msg),
    lambda: findings.all(),
    _mission_context,
)


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


class ForecastRequest(BaseModel):
    scenario: Scenario


def _finding(finding_id: str) -> Finding:
    f = next((x for x in findings.all() if x.id == finding_id), None)
    if f is None:
        raise HTTPException(404, f"Unknown finding {finding_id}")
    return f


@app.get("/api/findings/{finding_id}/forecasts", response_model=list[Forecast])
def list_forecasts(finding_id: str):
    return forecasts.list(_finding(finding_id).id)


@app.post("/api/findings/{finding_id}/forecasts", response_model=Forecast)
async def create_forecast(finding_id: str, req: ForecastRequest):
    """Reason-before-render time-travel preview (Muse Spark narrative + Muse Image edit); cached per scenario."""
    f = _finding(finding_id)
    if not meta.configured and forecasts.get(f.id, req.scenario) is None:
        raise HTTPException(503, "MODEL_API_KEY is not set")
    comp = sim.components[f.component_id]
    latest = sim.history[-1][1] if sim.history else {}
    context = {
        "host_component": {"name": comp.name, "kind": comp.kind},
        "asset": sim.assets[comp.asset_id].description,
        "environment": {sim.sensors[s].label: latest.get(s) for c in sim.assets[comp.asset_id].components if c.kind == "environment" for s in c.sensor_ids},
        **_mission_context(comp.id),
    }
    try:
        return await render_forecast(forecasts, f, req.scenario, context)
    except (MetaAPIError, ValidationError) as e:
        raise HTTPException(502, f"Forecast failed: {e}")


@app.get("/api/findings/{finding_id}/forecasts/{scenario}.jpg")
def forecast_image(finding_id: str, scenario: str):
    path = forecasts.image_path(finding_id, scenario)
    if path is None:
        raise HTTPException(404, "No forecast rendered yet")
    return FileResponse(path, media_type="image/jpeg")


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


class MissionRequest(BaseModel):
    component_id: str
    finding_id: str | None = None


@app.post("/api/missions")
async def create_mission(req: MissionRequest):
    """Plan a UAV re-scan of a component face (optionally a pinned finding's region) with Muse Wonder."""
    comp = sim.components.get(req.component_id)
    if comp is None:
        raise HTTPException(404, f"Unknown component {req.component_id}")
    if comp.geometry is None or comp.geometry.shape not in ("box", "cylinder"):
        raise HTTPException(400, f"{comp.name} has no planar face to plan against yet")
    if req.finding_id and not any(f.id == req.finding_id for f in findings.all()):
        raise HTTPException(404, f"Unknown finding {req.finding_id}")
    m = planner.start(req.component_id, req.finding_id)
    return {"id": m.id}


MAX_VOICE_BYTES = 8 * 1024 * 1024


@app.post("/api/voice", response_model=VoiceResult)
async def voice_command(file: UploadFile, selected_component_id: str | None = Form(None)):
    """Push-to-talk: WAV → Muse Voice Transcribe → Muse Spark intent → twin actions."""
    if not meta.configured:
        raise HTTPException(503, "MODEL_API_KEY is not set")
    wav = await file.read(MAX_VOICE_BYTES + 1)
    if len(wav) > MAX_VOICE_BYTES:
        raise HTTPException(413, "Audio larger than 8 MB")
    try:
        check_wav(wav)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        tr = await transcribe(wav, vocabulary([c.name for c in sim.components.values()]))
    except MetaAPIError as e:
        raise HTTPException(502, f"Transcription failed: {e}")
    transcript = (tr.get("transcript") or "").strip()
    if not transcript:
        return VoiceResult(transcript="", reply="I didn't catch anything; try again.", audio_ms=tr.get("audioDurationMs"), actions=[])

    context = {
        "selected_component_id": selected_component_id,
        "components": [{"id": c.id, "name": c.name, "asset": sim.assets[c.asset_id].name} for c in sim.components.values()],
    }
    try:
        intent = await interpret(transcript, context)
    except (MetaAPIError, ValidationError) as e:
        raise HTTPException(502, f"Could not interpret command: {e}")
    results = [await _run_voice_action(a, transcript) for a in intent.actions]
    return VoiceResult(transcript=transcript, reply=intent.reply, audio_ms=tr.get("audioDurationMs"), actions=results)


async def _run_voice_action(a, transcript: str) -> ActionResult:
    out = ActionResult(**a.model_dump(), status="done")
    comp = sim.components.get(a.component_id)
    if a.type == "none":
        out.status = "skipped"
        return out
    if a.type != "simulate_event" and comp is None:
        out.status, out.detail = "error", f"unknown component '{a.component_id}'"
        return out
    try:
        if a.type in ("select_component", "open_inspection"):
            out.status = "client"  # UI navigation happens in the browser
        elif a.type == "add_note":
            note = notes.add(comp.asset_id, comp.id, a.text or transcript, transcript)
            await sim.broadcast({"type": "notes", "added": [note.model_dump()]})
            out.detail = f"{note.id} on {comp.name}"
        elif a.type == "measure":
            measured = [f for f in findings.all() if f.component_id == comp.id and f.metrology]
            out.detail = (
                "; ".join(
                    f"{f.id} {f.concept}: {f.metrology.area_m2:.4f} m²"
                    + (f", L {f.metrology.length_m:.2f} m" if f.metrology.length_m is not None else "")
                    + (f", w≤{f.metrology.max_width_mm:.1f} mm" if f.metrology.max_width_mm is not None else "")
                    for f in measured
                )
                or f"No measured findings on {comp.name} yet: run an inspection with 'Captured at' set"
            )
            out.status = "done" if measured else "skipped"
        elif a.type == "run_triage":
            alert = next((x for x in reversed(sim.alerts) if x.component_id == comp.id), None)
            if alert is None:
                out.status, out.detail = "skipped", f"No alerts on {comp.name} to assess"
            else:
                twin.start(alert)
                out.detail = f"assessing {alert.id}"
        elif a.type == "plan_rescan":
            if comp.geometry is None or comp.geometry.shape not in ("box", "cylinder"):
                out.status, out.detail = "skipped", f"{comp.name} has no planar face to plan against"
            else:
                latest = next((f for f in reversed(findings.all()) if f.component_id == comp.id), None)
                m = planner.start(comp.id, latest.id if latest else None)
                out.detail = f"{m.id}" + (f" targeting {latest.id}" if latest else "")
        elif a.type == "simulate_event":
            target = comp.id if comp else "B07.P4"
            sim.inject_anomaly(target)
            out.detail = f"anomaly injected on {sim.components[target].name}"
    except Exception as e:  # one failed action must not drop the others
        out.status, out.detail = "error", f"{type(e).__name__}: {e}"
    return out


@app.get("/api/notes")
def list_notes():
    return [n.model_dump() for n in notes.all()]


@app.websocket("/ws/telemetry")
async def telemetry(ws: WebSocket):
    await ws.accept()
    await ws.send_json(
        {
            **sim.snapshot(),
            "findings": [f.model_dump() for f in findings.all()],
            "triages": twin.snapshot(),
            "missions": planner.snapshot(),
            "notes": [n.model_dump() for n in notes.all()],
        }
    )
    sim.clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sim.clients.discard(ws)
