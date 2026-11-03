"""AI Inspector: Muse Spark looks at the photo like an inspector, SAM 3.1 makes it pixel-accurate.

SAM 3.1 segments *things* precisely but, from a short text phrase alone, rarely finds subtle concrete
surface defects (measured on dacl10k: "spalling", "efflorescence", "exposed rebar" returned nothing).
Muse Spark reads the image and names and locates each defect and structural element (type, box, points
on it, severity, note). Then:
- area defects (spalling, efflorescence, rust, wet spots, cavities) and structural elements get a SAM 3.1
  box+point-prompted mask, one request per object so overlapping objects are not merged;
- linear defects (cracks, exposed rebar) keep Spark's traced centre line: SAM masks of thin objects bleed
  into the surrounding surface, while a polyline measures their length faithfully.
Defects are attributed to the element they sit on, and measured with that element's known size.
"""

import asyncio
import math
from typing import Literal

import numpy as np
from meta_sam_parser import (
    FramePrompt,
    PromptBox,
    PromptObject,
    PromptPoint,
    build_object_prompt,
    image_segmentation_format,
    parse_responses_stream,
)
from pydantic import BaseModel, ConfigDict

from .meta_client import MUSE_SPARK, SAM_31, meta
from .metrology import Metrology, ScaleRef, host_extent_px, host_scale_metrology
from .sam31 import CONCURRENCY, Concept, ConceptRun, Detection, SegmentationReport, _Raw, assign_hosts, records_to_detections

DefectType = Literal["crack", "alligator crack", "spalling", "exposed rebar", "efflorescence", "rust stain", "wet spot", "cavity"]
ElementType = Literal["pier", "column", "girder", "deck", "slab", "abutment", "bearing", "arch", "tunnel lining", "wall"]
LINEAR = {"crack", "exposed rebar"}

ASK = """You are a senior bridge and tunnel inspector reviewing one inspection photo ({w}x{h} px, origin top-left).
1. List each structural element clearly visible (pier, column, girder, deck, slab, abutment, bearing, arch, tunnel
   lining, wall) with a tight box.
2. List each distinct visible concrete defect with a tight box and 1-6 points that lie ON the defect. For cracks and
   exposed rebar, spread the points along the centre line from one end to the other so they trace it. Rate severity
   (low/medium/high) as an inspector would and add a short factual note (what you see, not speculation).
3. Write a two-sentence condition summary and the single most important recommended action.
Only report what is visible. All coordinates are integer pixels inside the image."""


class SparkDefect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: DefectType
    box: list[int]
    points: list[list[int]]
    severity: Literal["low", "medium", "high"]
    note: str


class SparkElement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: ElementType
    box: list[int]


class SparkReading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    elements: list[SparkElement]
    defects: list[SparkDefect]
    summary: str
    recommended_action: str


class InspectorReport(SegmentationReport):
    mode: Literal["ai_inspector"] = "ai_inspector"
    summary: str
    recommended_action: str


def _clamp_box(b: list[int], w: int, h: int) -> tuple[int, int, int, int] | None:
    if len(b) != 4:
        return None
    x1, y1, x2, y2 = (int(min(max(v, 0), lim - 1)) for v, lim in zip(b, (w, h, w, h)))
    x1, x2 = min(x1, x2), max(x1, x2)
    y1, y2 = min(y1, y2), max(y1, y2)
    return (x1, y1, x2, y2) if x2 - x1 >= 2 and y2 - y1 >= 2 else None


def _points(pts: list[list[int]], w: int, h: int) -> list[tuple[int, int]]:
    return [(int(min(max(p[0], 0), w - 1)), int(min(max(p[1], 0), h - 1))) for p in pts if len(p) == 2][:6]


async def read_image(image_url: str, w: int, h: int) -> SparkReading:
    resp = await meta.respond(
        MUSE_SPARK,
        [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": ASK.format(w=w, h=h)},
            {"type": "input_image", "image_url": image_url},
        ]}],
        reasoning={"effort": "low"},
        text={"format": {"type": "json_schema", "name": "inspection", "schema": SparkReading.model_json_schema(), "strict": True}},
        store=False,
    )
    return SparkReading.model_validate_json(meta.output_text(resp))


async def _segment_one(image_url: str, w: int, h: int, box, pts) -> list:
    prompt = build_object_prompt(
        size=(w, h),
        objects=[PromptObject(id="0", prompts=[FramePrompt(
            frame=0,
            box=PromptBox(left=box[0], top=box[1], right=box[2], bottom=box[3]),
            points=[PromptPoint(x=x, y=y, label="positive") for x, y in pts],
        )])],
    )
    body = {"model": SAM_31, "input": [{"type": "message", "role": "user", "content": [
        {"type": "input_text", "text": prompt}, {"type": "input_image", "image_url": image_url}]}],
        "metadata": {"mask_encoding": "one_bit"}}
    result = await parse_responses_stream(meta.stream("/responses", body), image_segmentation_format()).final_result()
    return list(result.records)


def _polyline_raw(idx: int, d: SparkDefect, box, pts) -> _Raw:
    """A linear defect as a thin raster along its traced centre line (used for host attribution)."""
    l, t, r, b = box[0], box[1], box[2] + 1, box[3] + 1
    raster = np.zeros((b - t, r - l), dtype=bool)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for k in range(n + 1):
            x = round(x0 + (x1 - x0) * k / n) - l
            y = round(y0 + (y1 - y0) * k / n) - t
            if 0 <= y < raster.shape[0] and 0 <= x < raster.shape[1]:
                raster[max(0, y - 1) : y + 2, max(0, x - 1) : x + 2] = True
    det = Detection(id=f"{d.type.replace(' ', '-')}-{idx}", concept=d.type, category="defect", box=tuple(map(float, box)),
                    confidence=None, area_px=int(raster.sum()), mask=None)
    return _Raw(det=det, raster=raster, bounds=(l, t, r, b))


def _length_px(pts: list[tuple[int, int]]) -> float:
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


async def ai_inspect(image_url: str, w: int, h: int, scale_ref: ScaleRef | None = None) -> InspectorReport:
    reading = await read_image(image_url, w, h)
    sem = asyncio.Semaphore(CONCURRENCY)

    async def mask_for(kind: str, idx: int, label: str, category: str, box, pts) -> tuple[ConceptRun, list[_Raw]]:
        async with sem:
            try:
                recs = await _segment_one(image_url, w, h, box, pts)
                raws = await asyncio.to_thread(records_to_detections, Concept(text=label, category=category), recs)
                for raw in raws:
                    raw.det.id = f"{label.replace(' ', '-')}-{idx}"
                return ConceptRun(text=f"{label} #{idx}", category=category, count=len(raws), ms=0), raws
            except Exception as e:
                root = e.__cause__ or e
                return ConceptRun(text=f"{label} #{idx}", category=category, count=0, ms=0, error=f"{type(root).__name__}: {root}"), []

    jobs, linear, meta_by_id = [], [], {}
    for i, el in enumerate(reading.elements):
        box = _clamp_box(el.box, w, h)
        if box:
            jobs.append(mask_for("element", i, el.type, "structural", box, []))
    for i, d in enumerate(reading.defects):
        box, pts = _clamp_box(d.box, w, h), _points(d.points, w, h)
        if not box:
            continue
        did = f"{d.type.replace(' ', '-')}-{i}"
        meta_by_id[did] = (d, pts)
        if d.type in LINEAR and len(pts) >= 2:
            linear.append(_polyline_raw(i, d, box, pts))
        else:
            jobs.append(mask_for("defect", i, d.type, "defect", box, pts))
    runs = await asyncio.gather(*jobs)
    raws = [r for _, rs in runs for r in rs] + linear
    await asyncio.to_thread(assign_hosts, raws)

    by_id = {r.det.id: r for r in raws}
    detections = []
    for r in raws:
        det = r.det
        if det.id in meta_by_id:
            d, pts = meta_by_id[det.id]
            det.severity, det.note = d.severity, d.note
            if d.type in LINEAR and len(pts) >= 2:
                det.polyline = [list(p) for p in pts]
                det.metrology = _linear_metrology(det.concept, pts, by_id.get(det.host_id or ""), scale_ref)
            elif scale_ref and det.host_id and r.raster is not None and by_id.get(det.host_id) is not None:
                det.metrology = host_scale_metrology(r.raster, det.concept, by_id[det.host_id].raster, scale_ref)
        detections.append(det)

    n_sam = len(jobs)
    return InspectorReport(
        model=f"{MUSE_SPARK} + {SAM_31}",
        width=w,
        height=h,
        concepts=[run for run, _ in runs],
        detections=detections,
        est_cost_usd=round(0.01 + 0.0025 * n_sam, 4),
        summary=reading.summary,
        recommended_action=reading.recommended_action,
    )


def _linear_metrology(concept: str, pts, host: _Raw | None, ref: ScaleRef | None) -> Metrology | None:
    if ref is None or host is None or host.raster is None:
        return None
    px = host_extent_px(host.raster, ref.axis)
    if px < 8:
        return None
    mm_per_px = ref.length_m * 1000 / px
    return Metrology(
        method="host-scale-2d",
        scale_mm_per_px=round(mm_per_px, 3),
        scale_note=f"{ref.component_name} {ref.axis} {ref.length_m:g} m ≈ {px:.0f} px",
        area_m2=0.0,
        perimeter_m=0.0,
        length_m=round(_length_px(pts) * mm_per_px / 1000, 3),
        resolution_mm=round(mm_per_px, 2),
        assumptions=[f"Camera roughly square-on to the {ref.component_name}", "Length along the inspector-traced centre line"],
    )
