"""Metric defect quantification.

Two paths over the same mask:

1. host_scale_metrology: metric scale from the defect's host element. SAM 3.1 segments the element
   (e.g. a pier), the twin knows its real dimension (e.g. 2.4 m wide), and the element's median pixel
   extent gives mm/px. Assumes a roughly fronto-parallel view of the element's front face.

2. raycast_metrology: the normal-gradient plane raycasting method (ASCE JCCE). Given a metric depth
   map and camera intrinsics (e.g. from SAM 3D), depth gradients dD/dx, dD/dy give surface normals,
   a local plane is fitted, and each pixel's corner rays are intersected with that plane to measure true
   area/perimeter and the surface inclination. Used once a depth source is available.
"""

from typing import Literal

import numpy as np
from pydantic import BaseModel
from scipy import ndimage
from skimage.measure import find_contours
from skimage.morphology import skeletonize

from .models import Component

MAX_PLAUSIBLE_CRACK_MM = 50.0  # wider "cracks" are almost always spalling or a segmentation error
MAX_HOST_COVERAGE = 0.5

VERTICAL_KINDS = {"pier", "abutment", "monolith", "column", "portal"}  # scale from horizontal width
HORIZONTAL_KINDS = {"girder", "deck", "invert"}  # scale from vertical height


class ScaleRef(BaseModel):
    component_id: str
    component_name: str
    axis: Literal["width", "height"]
    length_m: float


class Metrology(BaseModel):
    method: Literal["host-scale-2d", "normal-gradient-raycast"]
    scale_mm_per_px: float | None
    scale_note: str
    area_m2: float
    perimeter_m: float
    length_m: float | None = None  # crack-like defects only
    max_width_mm: float | None = None
    mean_width_mm: float | None = None
    inclination_deg: float | None = None  # needs depth
    resolution_mm: float | None = None  # one pixel on the surface
    assumptions: list[str]
    warnings: list[str] = []


def scale_ref_for(comp: Component) -> ScaleRef | None:
    g = comp.geometry
    if g is None or g.shape != "box":
        return None
    if comp.kind in VERTICAL_KINDS:
        return ScaleRef(component_id=comp.id, component_name=comp.name, axis="width", length_m=g.size[0])
    if comp.kind in HORIZONTAL_KINDS:
        return ScaleRef(component_id=comp.id, component_name=comp.name, axis="height", length_m=g.size[1])
    return None


def _contours(mask: np.ndarray) -> list[np.ndarray]:
    """Closed sub-pixel boundary polylines (marching squares) as (row, col) in the mask's pixel-centre coords."""
    return [c - 1 for c in find_contours(np.pad(mask, 1).astype(float), 0.5)]


def _polyline_length(pts: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=-1).sum())


def host_extent_px(host: np.ndarray, axis: Literal["width", "height"]) -> float:
    """Median per-row width (or per-column height) of the host mask: robust to tapering and partial occlusion."""
    spans = host.sum(axis=1 if axis == "width" else 0)
    spans = spans[spans > 0]
    return float(np.median(spans)) if spans.size else 0.0


def is_crack(concept: str) -> bool:
    return "crack" in concept.lower()


def _crack_geometry(mask: np.ndarray) -> tuple[float, float, float]:
    """(centre-line length px, max width px, mean width px) from the skeleton and the distance transform."""
    m = np.pad(mask, 1)  # background border so distances are measured to the defect edge, not the crop edge
    sk = skeletonize(m)
    if not sk.any():
        return 0.0, 0.0, 0.0
    # 8-connected link length; a diagonal only counts when no orthogonal path already joins the pair.
    orth = (sk[:, :-1] & sk[:, 1:]).sum() + (sk[:-1, :] & sk[1:, :]).sum()
    d1 = sk[:-1, :-1] & sk[1:, 1:] & ~sk[:-1, 1:] & ~sk[1:, :-1]
    d2 = sk[:-1, 1:] & sk[1:, :-1] & ~sk[:-1, :-1] & ~sk[1:, 1:]
    length = float(orth + np.sqrt(2) * (d1.sum() + d2.sum())) + 1.0
    # EDT at the centre line is distance to the nearest background pixel centre: width ≈ 2d - 1.
    widths = np.maximum(2 * ndimage.distance_transform_edt(m)[sk] - 1, 1.0)
    return length, float(widths.max()), float(widths.mean())


def _crack_warning(m: Metrology) -> None:
    if m.max_width_mm is not None and m.max_width_mm > MAX_PLAUSIBLE_CRACK_MM:
        m.warnings.append(
            f"Crack width {m.max_width_mm:.0f} mm is implausible (>{MAX_PLAUSIBLE_CRACK_MM:.0f} mm): likely spalling or mis-segmentation"
        )


def host_scale_metrology(defect: np.ndarray, concept: str, host: np.ndarray, ref: ScaleRef) -> Metrology | None:
    px = host_extent_px(host, ref.axis)
    if px < 8:  # too few pixels across the host to trust the scale
        return None
    mm_per_px = ref.length_m * 1000 / px
    s = mm_per_px / 1000  # m per px
    out = Metrology(
        method="host-scale-2d",
        scale_mm_per_px=round(mm_per_px, 3),
        scale_note=f"{ref.component_name} {ref.axis} {ref.length_m:g} m ≈ {px:.0f} px",
        area_m2=round(float(defect.sum()) * s * s, 5),
        perimeter_m=round(sum(_polyline_length(c) for c in _contours(defect)) * s, 4),
        resolution_mm=round(mm_per_px, 2),
        assumptions=[
            f"Camera roughly square-on to the {ref.component_name} front face",
            "Defect lies in the plane of the host element",
            "Inclination needs depth (SAM 3D raycasting)",
        ],
    )
    if is_crack(concept):
        length, wmax, wmean = _crack_geometry(defect)
        out.length_m = round(length * s, 4)
        out.max_width_mm = round(wmax * mm_per_px, 2)
        out.mean_width_mm = round(wmean * mm_per_px, 2)
        _crack_warning(out)
    coverage = defect.sum() / max(host.sum(), 1)
    if coverage > MAX_HOST_COVERAGE:
        out.warnings.append(f"Defect covers {coverage:.0%} of the host element: check segmentation before relying on size")
    return out


# --- normal-gradient plane raycasting ------------------------------------------------------------


def _backproject(us: np.ndarray, vs: np.ndarray, depth: np.ndarray, K: np.ndarray) -> np.ndarray:
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    return np.stack([(us - cx) * depth / fx, (vs - cy) * depth / fy, depth], axis=-1)


def fit_plane_from_depth(mask: np.ndarray, depth: np.ndarray, K: np.ndarray, margin: int = 6) -> tuple[np.ndarray, float]:
    """Unit normal n (facing the camera) and offset d with n·P = d, from depth gradients around the defect.

    Normals come from the depth gradients dD/dx, dD/dy (tangents of the back-projected surface);
    the defect neighbourhood is used so the defect's own relief (spalling depth) does not tilt the plane.
    """
    ys, xs = np.nonzero(mask)
    y0, y1 = max(ys.min() - margin, 0), min(ys.max() + margin + 1, mask.shape[0])
    x0, x1 = max(xs.min() - margin, 0), min(xs.max() + margin + 1, mask.shape[1])
    D = depth[y0:y1, x0:x1]
    vv, uu = np.mgrid[y0:y1, x0:x1].astype(float)
    P = _backproject(uu, vv, D, K)
    dPdv, dPdu = np.gradient(P, axis=(0, 1))  # tangents from dD/dy, dD/dx
    n = np.cross(dPdu, dPdv).reshape(-1, 3)
    ring = ~mask[y0:y1, x0:x1].ravel()
    valid = ring & np.isfinite(n).all(axis=1) & (np.linalg.norm(n, axis=1) > 0)
    if not valid.any():
        valid = np.isfinite(n).all(axis=1)
    n = n[valid] / np.linalg.norm(n[valid], axis=1, keepdims=True)
    n = np.median(n, axis=0)
    n /= np.linalg.norm(n)
    if n[2] > 0:  # face the camera (camera looks down +z)
        n = -n
    d = float(np.median(P.reshape(-1, 3)[valid] @ n))
    return n, d


def raycast_metrology(mask: np.ndarray, depth: np.ndarray, K: np.ndarray, concept: str) -> Metrology:
    """True surface area / perimeter / inclination by intersecting pixel-corner rays with the fitted plane."""
    n, d = fit_plane_from_depth(mask, depth, K)
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = mask[y0:y1, x0:x1]

    # Pixel-corner grid -> rays -> plane intersections.
    cv_, cu_ = np.mgrid[y0 - 0.5 : y1 + 0.5 : 1, x0 - 0.5 : x1 + 0.5 : 1]
    rays = np.stack([(cu_ - K[0, 2]) / K[0, 0], (cv_ - K[1, 2]) / K[1, 1], np.ones_like(cu_)], axis=-1)
    t = d / (rays @ n)
    C = rays * t[..., None]  # (h+1, w+1, 3)

    # Each pixel footprint = quad (two triangles).
    a, b, c, e = C[:-1, :-1], C[:-1, 1:], C[1:, 1:], C[1:, :-1]
    quad = 0.5 * (np.linalg.norm(np.cross(b - a, c - a), axis=-1) + np.linalg.norm(np.cross(c - a, e - a), axis=-1))
    area = float(quad[m].sum())

    # Perimeter: lift the sub-pixel boundary onto the plane and measure it in 3D.
    perim = 0.0
    for c in _contours(m):
        r = np.stack([(c[:, 1] + x0 - K[0, 2]) / K[0, 0], (c[:, 0] + y0 - K[1, 2]) / K[1, 1], np.ones(len(c))], -1)
        perim += _polyline_length(r * (d / (r @ n))[:, None])

    # Mean metric size of one pixel on the surface, for crack length/width and resolution.
    px_m = float(np.sqrt(quad[m].mean()))
    out = Metrology(
        method="normal-gradient-raycast",
        scale_mm_per_px=None,
        scale_note=f"depth-fitted plane, normal ({n[0]:.2f}, {n[1]:.2f}, {n[2]:.2f})",
        area_m2=round(area, 5),
        perimeter_m=round(perim, 4),
        inclination_deg=round(float(np.degrees(np.arccos(min(1.0, abs(n[2]))))), 2),
        resolution_mm=round(px_m * 1000, 2),
        assumptions=["Defect neighbourhood is locally planar"],
    )
    if is_crack(concept):
        length, wmax, wmean = _crack_geometry(m)
        out.length_m = round(length * px_m, 4)
        out.max_width_mm = round(wmax * px_m * 1000, 2)
        out.mean_width_mm = round(wmean * px_m * 1000, 2)
        _crack_warning(out)
    return out
