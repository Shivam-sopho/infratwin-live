"""Client for the SAM 3D Objects / SAM 3D Body Modal endpoints, plus the two features built on them.

- Lift a pinned defect to 3D: SAM 3D Objects reconstructs the masked region of the finding's photo as a
  Gaussian point cloud with a camera-frame pose (R, t, s). The twin shows it at the finding's patch.
- Work-zone geofencing: on one inspection frame, SAM 3D Body localises people and SAM 3D Objects
  localises the defect, both in the same camera frame, so worker-to-hazard distances are directly
  comparable. Workers within the exclusion radius horizontally, below an overhead defect, are flagged.
"""

import asyncio
import base64
import io
import math
import time
from pathlib import Path
from typing import Literal

import httpx
import numpy as np
from PIL import Image
from pydantic import BaseModel

from .config import settings

TIMEOUT = httpx.Timeout(600.0, connect=20.0)  # cold start loads multi-GB checkpoints


class Sam3DError(RuntimeError):
    pass


def configured() -> dict[str, bool]:
    return {"objects": bool(settings.sam3d_objects_url), "body": bool(settings.sam3d_body_url)}


async def _post(url: str, body: dict) -> dict:
    headers = {}
    if settings.modal_proxy_key:
        headers = {"Modal-Key": settings.modal_proxy_key, "Modal-Secret": settings.modal_proxy_secret}
    async with httpx.AsyncClient(timeout=TIMEOUT) as http:
        r = await http.post(url, json=body, headers=headers)
    if r.status_code >= 400:
        raise Sam3DError(f"{r.status_code}: {r.text[:500]}")
    return r.json()


def _b64_payload(data_url_or_bytes: str | bytes) -> str:
    if isinstance(data_url_or_bytes, bytes):
        return base64.b64encode(data_url_or_bytes).decode()
    return data_url_or_bytes.split(",", 1)[1]


async def reconstruct(image: str | bytes, mask_png: str | bytes, max_points: int = 40000) -> dict:
    if not settings.sam3d_objects_url:
        raise Sam3DError("SAM3D_OBJECTS_URL is not set (deploy modal_workers/sam3d_service.py)")
    return await _post(
        settings.sam3d_objects_url,
        {"image_b64": _b64_payload(image), "mask_b64": _b64_payload(mask_png), "max_points": max_points},
    )


async def localize_people(image: str | bytes) -> dict:
    if not settings.sam3d_body_url:
        raise Sam3DError("SAM3D_BODY_URL is not set (deploy modal_workers/sam3d_service.py)")
    return await _post(settings.sam3d_body_url, {"image_b64": _b64_payload(image)})


# --- lifted defects -----------------------------------------------------------------------------


class Lift(BaseModel):
    finding_id: str
    t: float
    n_points: int
    rotation: list[float]
    translation: list[float]
    scale: list[float]
    points_url: str
    extent: list[float]  # bounding-box size of the cloud in its own frame


class LiftStore:
    def __init__(self, root: Path):
        self.root = root

    def get(self, finding_id: str) -> Lift | None:
        p = self.root / f"{finding_id}.json"
        return Lift.model_validate_json(p.read_text()) if p.exists() else None

    def points_path(self, finding_id: str) -> Path | None:
        p = self.root / f"{finding_id}.bin"
        return p if p.exists() else None

    def all(self) -> list[Lift]:
        return [Lift.model_validate_json(p.read_text()) for p in sorted(self.root.glob("*.json"))] if self.root.exists() else []

    def save(self, finding_id: str, out: dict) -> Lift:
        pts = np.frombuffer(base64.b64decode(out["points_b64"]), dtype=np.float32).reshape(-1, 6)
        extent = (pts[:, :3].max(axis=0) - pts[:, :3].min(axis=0)).tolist() if len(pts) else [0.0, 0.0, 0.0]
        lift = Lift(
            finding_id=finding_id,
            t=time.time(),
            n_points=len(pts),
            rotation=[float(x) for x in out.get("rotation") or []],
            translation=[float(x) for x in out.get("translation") or []],
            scale=[float(x) for x in out.get("scale") or []],
            points_url=f"/api/findings/{finding_id}/lift/points.bin",
            extent=extent,
        )
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / f"{finding_id}.bin").write_bytes(pts.tobytes())
        (self.root / f"{finding_id}.json").write_text(lift.model_dump_json())
        return lift


# --- work-zone geofencing -----------------------------------------------------------------------


class Worker(BaseModel):
    index: int
    position: list[float] | None  # camera frame, metres (x right, y down, z forward)
    bbox: list[float] | None
    horizontal_distance_m: float | None
    below_defect: bool | None
    verdict: Literal["inside_exclusion", "clear", "unknown"]


class WorkZoneReport(BaseModel):
    radius_m: float
    defect_position: list[float] | None
    workers: list[Worker]
    any_violation: bool
    note: str


def full_frame_mask(width: int, height: int, bounds: tuple[int, int, int, int], mask_png_data_url: str) -> bytes:
    """Place a box-local mask PNG into a full-frame binary PNG."""
    l, t, r, b = bounds
    local = Image.open(io.BytesIO(base64.b64decode(mask_png_data_url.split(",", 1)[1])))
    alpha = local.split()[-1] if local.mode in ("RGBA", "LA") else local.convert("L")
    alpha = alpha.resize((max(1, r - l), max(1, b - t)), Image.NEAREST)
    full = Image.new("L", (width, height), 0)
    full.paste(alpha, (l, t))
    buf = io.BytesIO()
    full.save(buf, "PNG")
    return buf.getvalue()


def geofence(defect_t: list[float] | None, people: list[dict], radius_m: float) -> WorkZoneReport:
    workers = []
    for i, p in enumerate(people):
        pos = p.get("cam_t")
        if not pos or len(pos) != 3 or not defect_t or len(defect_t) != 3:
            workers.append(Worker(index=i, position=pos, bbox=p.get("bbox"), horizontal_distance_m=None, below_defect=None, verdict="unknown"))
            continue
        dx, dz = pos[0] - defect_t[0], pos[2] - defect_t[2]
        horiz = math.hypot(dx, dz)  # ground-plane distance in the camera frame (y is vertical)
        below = pos[1] > defect_t[1]  # camera y points down
        workers.append(
            Worker(
                index=i,
                position=[round(v, 3) for v in pos],
                bbox=p.get("bbox"),
                horizontal_distance_m=round(horiz, 2),
                below_defect=below,
                verdict="inside_exclusion" if horiz < radius_m and below else "clear",
            )
        )
    return WorkZoneReport(
        radius_m=radius_m,
        defect_position=[round(v, 3) for v in defect_t] if defect_t and len(defect_t) == 3 else None,
        workers=workers,
        any_violation=any(w.verdict == "inside_exclusion" for w in workers),
        note="Positions are SAM 3D camera-frame estimates from a single image; treat distances as approximate.",
    )


async def work_zone(image_jpeg: bytes, mask_png: bytes, radius_m: float) -> WorkZoneReport:
    body_out, obj_out = await asyncio.gather(localize_people(image_jpeg), reconstruct(image_jpeg, mask_png, max_points=2000))
    return geofence(obj_out.get("translation"), body_out.get("people", []), radius_m)
