"""SAM 3.1 video tracking of inspection clips (drone / walk-through footage).

Clips are re-encoded to a fixed low frame rate first: SAM bills per frame, and the
UI maps playback time to frame index as round(t * fps), so the rate must be known.
Object ids are stable across frames within one response, giving per-defect tracks.
"""

import asyncio
import time
from collections import Counter, defaultdict
from fractions import Fraction

import av
import numpy as np
from meta_sam_parser import parse_responses_stream, video_segmentation_format
from pydantic import BaseModel

from .meta_client import SAM_31, meta
from .metrology import Metrology, ScaleRef
from .sam31 import CONCURRENCY, Category, Concept, ConceptRun, MaskOut, _Raw, assign_hosts, measure, records_to_detections

TARGET_FPS = 5
MAX_FRAMES = 100  # 20 s at 5 fps
MAX_EDGE_PX = 960
COST_PER_FRAME_USD = 0.0002  # $0.20 / 1k frames
MIN_BILLED_FRAMES = 50


class VideoMeta(BaseModel):
    width: int
    height: int
    fps: int
    n_frames: int


class TrackFrame(BaseModel):
    f: int
    box: tuple[float, float, float, float]
    confidence: float | None
    area_px: int
    mask: MaskOut | None


class Track(BaseModel):
    id: str
    concept: str
    category: Category
    frames: list[TrackFrame]
    best_frame: int  # largest visible area: the clearest view for thumbnails and pinning
    confidence: float | None
    host_id: str | None = None
    host_overlap: float | None = None
    metrology: Metrology | None = None  # measured on the best (largest) view


class VideoReport(BaseModel):
    model: str
    width: int
    height: int
    fps: int
    n_frames: int
    concepts: list[ConceptRun]
    tracks: list[Track]
    est_cost_usd: float


def transcode(src: str, dst: str) -> VideoMeta:
    """Resample to TARGET_FPS, cap length and long edge, bake in display rotation; H.264 MP4."""
    with av.open(src) as inp, av.open(dst, "w", format="mp4") as out:
        vs = inp.streams.video[0]
        vs.thread_type = "AUTO"
        ost = None
        t0: float | None = None
        n = 0
        for frame in inp.decode(vs):
            if frame.time is None:
                continue
            t0 = frame.time if t0 is None else t0
            if frame.time - t0 + 1e-6 < n / TARGET_FPS:
                continue
            img = frame.to_image()
            if frame.rotation:
                img = img.rotate(frame.rotation, expand=True)
            img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))
            w, h = img.width & ~1, img.height & ~1  # yuv420p needs even dimensions
            if ost is None:
                ost = out.add_stream("libx264", rate=TARGET_FPS)
                ost.width, ost.height, ost.pix_fmt = w, h, "yuv420p"
                ost.options = {"crf": "23", "preset": "veryfast"}
            vf = av.VideoFrame.from_image(img.crop((0, 0, w, h))).reformat(format="yuv420p")
            vf.pts, vf.time_base = n, Fraction(1, TARGET_FPS)
            for packet in ost.encode(vf):
                out.mux(packet)
            n += 1
            if n >= MAX_FRAMES:
                break
        if ost is None:
            raise ValueError("No decodable video frames")
        for packet in ost.encode():
            out.mux(packet)
        return VideoMeta(width=ost.width, height=ost.height, fps=TARGET_FPS, n_frames=n)


def records_to_frame_raws(concept: Concept, records) -> dict[int, list[_Raw]]:
    by_frame: dict[int, list] = defaultdict(list)
    for r in records:
        frame = getattr(r, "frame", None)
        if frame is not None:
            by_frame[frame.frame_index].append(r)
    return {f: records_to_detections(concept, recs) for f, recs in by_frame.items()}


def build_tracks(raws_by_frame: dict[int, list[_Raw]], scale_ref: ScaleRef | None = None) -> list[Track]:
    """Attribute defects to hosts frame by frame, then fold detections into per-object tracks."""
    frames_by_id: dict[str, list[tuple[int, _Raw]]] = defaultdict(list)
    for f in sorted(raws_by_frame):
        assign_hosts(raws_by_frame[f])
        for raw in raws_by_frame[f]:
            frames_by_id[raw.det.id].append((f, raw))

    tracks = []
    for tid, items in frames_by_id.items():
        first = items[0][1].det
        hosts = Counter(r.det.host_id for _, r in items if r.det.host_id)
        host_id = hosts.most_common(1)[0][0] if hosts else None
        overlaps = [r.det.host_overlap for _, r in items if r.det.host_id == host_id and r.det.host_overlap]
        confs = [r.det.confidence for _, r in items if r.det.confidence is not None]
        best_f, best = max(items, key=lambda it: it[1].det.area_px)
        metrology = None
        if first.category == "defect":
            frame = {r.det.id: r for r in raws_by_frame[best_f]}
            metrology = measure(best, frame.get(best.det.host_id or host_id or ""), scale_ref)
        tracks.append(
            Track(
                id=tid,
                concept=first.concept,
                category=first.category,
                frames=[
                    TrackFrame(f=f, box=r.det.box, confidence=r.det.confidence, area_px=r.det.area_px, mask=r.det.mask)
                    for f, r in items
                ],
                best_frame=best_f,
                confidence=max(confs) if confs else None,
                host_id=host_id,
                host_overlap=round(float(np.mean(overlaps)), 3) if overlaps else None,
                metrology=metrology,
            )
        )
    return tracks


def _request_body(concept: Concept, file_id: str) -> dict:
    return {
        "model": SAM_31,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept.text},
                    {"type": "input_video", "file_id": file_id},
                ],
            }
        ],
        "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
    }


async def _run_concept(concept: Concept, file_id: str, sem: asyncio.Semaphore) -> tuple[ConceptRun, dict[int, list[_Raw]]]:
    async with sem:
        t0 = time.perf_counter()
        try:
            events = meta.stream("/responses", _request_body(concept, file_id))
            result = await parse_responses_stream(events, video_segmentation_format()).final_result()
            by_frame = await asyncio.to_thread(records_to_frame_raws, concept, result.records)
            error = None
        except Exception as e:
            root = e.__cause__ or e
            by_frame, error = {}, f"{type(root).__name__}: {root}"
        ms = int((time.perf_counter() - t0) * 1000)
    n_objects = len({r.det.id for raws in by_frame.values() for r in raws})
    return ConceptRun(text=concept.text, category=concept.category, count=n_objects, ms=ms, error=error), by_frame


async def segment_video(
    path: str, video: VideoMeta, concepts: list[Concept], scale_ref: ScaleRef | None = None
) -> VideoReport:
    file_id = await meta.upload_file(path, "clip.mp4", "video/mp4")
    try:
        sem = asyncio.Semaphore(CONCURRENCY)
        runs = await asyncio.gather(*(_run_concept(c, file_id, sem) for c in concepts))
    finally:
        try:
            await meta.delete_file(file_id)
        except Exception:
            pass

    merged: dict[int, list[_Raw]] = defaultdict(list)
    for _, by_frame in runs:
        for f, raws in by_frame.items():
            merged[f].extend(raws)
    tracks = await asyncio.to_thread(build_tracks, merged, scale_ref)
    return VideoReport(
        model=SAM_31,
        width=video.width,
        height=video.height,
        fps=video.fps,
        n_frames=video.n_frames,
        concepts=[run for run, _ in runs],
        tracks=tracks,
        est_cost_usd=round(COST_PER_FRAME_USD * max(video.n_frames, MIN_BILLED_FRAMES) * len(concepts), 4),
    )
