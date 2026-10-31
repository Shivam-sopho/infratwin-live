"""SAM 3.1 dual-vocabulary segmentation of inspection frames.

One frame is segmented against two vocabularies at once: macro structural elements
(pier, girder, ...) and micro surface defects (dacl10k taxonomy). SAM 3.1 takes one
concept per request, so concepts fan out concurrently. Each defect is then attributed
to the structural element its mask overlaps most, which is what lets a crack be
pinned to "Pier 4" rather than floating in pixel space.
"""

import asyncio
import base64
import io
import re
import time
from dataclasses import dataclass
from typing import Literal

import numpy as np
from meta_sam_parser import (
    SegmentationBoxRecord,
    SegmentationMaskRecord,
    decode_mask_to_raster,
    image_segmentation_format,
    parse_responses_stream,
)
from PIL import Image, ImageOps
from pydantic import BaseModel

from .meta_client import SAM_31, meta
from .metrology import Metrology, ScaleRef, host_scale_metrology

Category = Literal["structural", "defect"]

MAX_EDGE_PX = 1600
COST_PER_IMAGE_USD = 0.0025  # $2.50 / 1k images
CONCURRENCY = 6
MIN_HOST_OVERLAP = 0.3  # fraction of a defect's area that must lie on a host element


class Concept(BaseModel):
    text: str
    category: Category


DEFAULT_CONCEPTS: list[Concept] = [
    Concept(text=t, category="structural")
    for t in ["concrete pier", "bridge girder", "bridge deck", "support column", "tunnel lining"]
] + [
    Concept(text=t, category="defect")
    for t in [
        "concrete crack",
        "alligator crack",
        "concrete spalling",
        "exposed rebar",
        "efflorescence",
        "rust stain",
        "wet spot",
    ]
]


class MaskOut(BaseModel):
    bounds: tuple[int, int, int, int]  # left, top, right, bottom (half-open, image px)
    png: str  # data URL; white RGBA whose alpha is the box-local mask


class Detection(BaseModel):
    id: str
    concept: str
    category: Category
    box: tuple[float, float, float, float]
    confidence: float | None
    area_px: int
    mask: MaskOut | None
    host_id: str | None = None
    host_overlap: float | None = None
    metrology: Metrology | None = None


class ConceptRun(BaseModel):
    text: str
    category: Category
    count: int
    ms: int
    error: str | None = None


class SegmentationReport(BaseModel):
    model: str
    width: int
    height: int
    concepts: list[ConceptRun]
    detections: list[Detection]
    est_cost_usd: float


@dataclass
class _Raw:
    det: Detection
    raster: np.ndarray | None  # bool, box-local, shape (bottom - top, right - left)
    bounds: tuple[int, int, int, int]


def prepare_image(data: bytes) -> tuple[str, int, int]:
    """Normalise orientation, cap the long edge, and return (jpeg data URL, width, height)."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}", img.width, img.height


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _mask_png(raster: np.ndarray) -> str:
    alpha = Image.fromarray(raster.astype(np.uint8) * 255, "L")
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    buf = io.BytesIO()
    rgba.save(buf, "PNG", optimize=True)
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"


def records_to_detections(concept: Concept, records) -> list[_Raw]:
    """Pair box + mask records by object id and decode masks. CPU-bound; run off the event loop."""
    boxes = {r.object_id: r for r in records if isinstance(r, SegmentationBoxRecord)}
    masks = {r.object_id: r for r in records if isinstance(r, SegmentationMaskRecord)}
    out: list[_Raw] = []
    for oid, box in boxes.items():
        m = masks.get(oid)
        raster, mask_out = None, None
        if m is not None:
            b = m.bounds
            bounds = (int(b.left), int(b.top), int(b.right), int(b.bottom))
            raster = np.frombuffer(decode_mask_to_raster(m.mask), dtype=np.uint8).reshape(m.mask.height, m.mask.width) > 0
            bw, bh = bounds[2] - bounds[0], bounds[3] - bounds[1]
            if raster.shape != (bh, bw):
                img = Image.fromarray(raster.astype(np.uint8) * 255, "L").resize((bw, bh), Image.NEAREST)
                raster = np.asarray(img) > 0
            mask_out = MaskOut(bounds=bounds, png=_mask_png(raster))
        else:
            bounds = (int(box.left), int(box.top), int(box.right), int(box.bottom))
        area = int(raster.sum()) if raster is not None else (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        det = Detection(
            id=f"{_slug(concept.text)}-{oid}",
            concept=concept.text,
            category=concept.category,
            box=(box.left, box.top, box.right, box.bottom),
            confidence=box.confidence,
            area_px=area,
            mask=mask_out,
        )
        out.append(_Raw(det=det, raster=raster, bounds=bounds))
    return out


def _overlap_px(a: _Raw, b: _Raw) -> int:
    l, t = max(a.bounds[0], b.bounds[0]), max(a.bounds[1], b.bounds[1])
    r, btm = min(a.bounds[2], b.bounds[2]), min(a.bounds[3], b.bounds[3])
    if r <= l or btm <= t:
        return 0

    def crop(x: _Raw) -> np.ndarray:
        if x.raster is None:
            return np.ones((btm - t, r - l), dtype=bool)
        return x.raster[t - x.bounds[1] : btm - x.bounds[1], l - x.bounds[0] : r - x.bounds[0]]

    return int((crop(a) & crop(b)).sum())


def assign_hosts(raws: list[_Raw]) -> None:
    """Attribute each defect to the structural element covering most of its area."""
    structural = [x for x in raws if x.det.category == "structural"]
    for d in (x for x in raws if x.det.category == "defect"):
        if d.det.area_px == 0:
            continue
        best, best_frac = None, 0.0
        for s in structural:
            frac = _overlap_px(d, s) / d.det.area_px
            if frac > best_frac:
                best, best_frac = s, frac
        if best is not None and best_frac >= MIN_HOST_OVERLAP:
            d.det.host_id = best.det.id
            d.det.host_overlap = round(best_frac, 3)


def measure(defect: _Raw, host: _Raw | None, ref: ScaleRef | None) -> Metrology | None:
    """Metric size of a defect, scaled by its host element's known dimension."""
    if ref is None or host is None or defect.raster is None or host.raster is None:
        return None
    return host_scale_metrology(defect.raster, defect.det.concept, host.raster, ref)


def assign_and_measure(raws: list[_Raw], ref: ScaleRef | None) -> None:
    assign_hosts(raws)
    by_id = {r.det.id: r for r in raws}
    for d in raws:
        if d.det.category == "defect" and d.det.host_id:
            d.det.metrology = measure(d, by_id.get(d.det.host_id), ref)


def _request_body(concept: Concept, image_url: str) -> dict:
    return {
        "model": SAM_31,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept.text},
                    {"type": "input_image", "image_url": image_url},
                ],
            }
        ],
        "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
    }


async def _run_concept(concept: Concept, image_url: str, sem: asyncio.Semaphore) -> tuple[ConceptRun, list[_Raw]]:
    async with sem:
        t0 = time.perf_counter()
        try:
            events = meta.stream("/responses", _request_body(concept, image_url))
            result = await parse_responses_stream(events, image_segmentation_format()).final_result()
            raws = await asyncio.to_thread(records_to_detections, concept, result.records)
            error = None
        except Exception as e:  # one failed concept must not sink the whole frame
            root = e.__cause__ or e  # the parser wraps source errors (e.g. HTTP 401) — surface the original
            raws, error = [], f"{type(root).__name__}: {root}"
        ms = int((time.perf_counter() - t0) * 1000)
    return ConceptRun(text=concept.text, category=concept.category, count=len(raws), ms=ms, error=error), raws


async def segment_image(
    image_url: str, width: int, height: int, concepts: list[Concept], scale_ref: ScaleRef | None = None
) -> SegmentationReport:
    sem = asyncio.Semaphore(CONCURRENCY)
    runs = await asyncio.gather(*(_run_concept(c, image_url, sem) for c in concepts))
    raws = [r for _, rs in runs for r in rs]
    await asyncio.to_thread(assign_and_measure, raws, scale_ref)
    return SegmentationReport(
        model=SAM_31,
        width=width,
        height=height,
        concepts=[run for run, _ in runs],
        detections=[r.det for r in raws],
        est_cost_usd=round(COST_PER_IMAGE_USD * len(concepts), 4),
    )
