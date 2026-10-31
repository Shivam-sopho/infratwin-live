import numpy as np
from PIL import Image, ImageDraw

from app.corridor import build_corridor
from app.metrology import (
    ScaleRef,
    host_extent_px,
    host_scale_metrology,
    raycast_metrology,
    scale_ref_for,
)

K = np.array([[1000.0, 0, 320], [0, 1000.0, 240], [0, 0, 1]])
W, H = 640, 480


def _tilted_plane(theta_deg: float, dist: float = 5.0):
    """Plane through (0,0,dist) rotated theta about the camera x-axis: returns (normal, d, depth map)."""
    th = np.radians(theta_deg)
    n = np.array([0.0, np.sin(th), -np.cos(th)])  # faces the camera
    p0 = np.array([0.0, 0.0, dist])
    d = float(n @ p0)
    vv, uu = np.mgrid[0:H, 0:W].astype(float)
    rays = np.stack([(uu - K[0, 2]) / K[0, 0], (vv - K[1, 2]) / K[1, 1], np.ones_like(uu)], -1)
    depth = (d / (rays @ n)) * 1.0  # z component of ray is 1
    return n, p0, depth


def _project_polygon(points3d):
    uv = [(K[0, 0] * x / z + K[0, 2], K[1, 1] * y / z + K[1, 2]) for x, y, z in points3d]
    img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(img).polygon(uv, fill=255)
    return np.asarray(img) > 0


def test_raycast_recovers_area_and_inclination_on_tilted_plane():
    theta = 30.0
    n, p0, depth = _tilted_plane(theta)
    # 0.5 m x 0.5 m square lying in the plane, centred at p0.
    e1 = np.array([1.0, 0, 0])
    e2 = np.cross(n, e1)
    e2 /= np.linalg.norm(e2)
    corners = [p0 + a * e1 * 0.25 + b * e2 * 0.25 for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    mask = _project_polygon(corners)

    m = raycast_metrology(mask, depth, K, "concrete spalling")
    assert abs(m.inclination_deg - theta) < 0.5
    assert abs(m.area_m2 - 0.25) / 0.25 < 0.03
    assert abs(m.perimeter_m - 2.0) / 2.0 < 0.08
    # Naive 2D scaling at the centre depth would under-report the foreshortened area.
    naive = mask.sum() * (5.0 / 1000) ** 2
    assert naive < 0.25 * 0.93


def test_raycast_fronto_parallel_crack_width():
    _, _, depth = _tilted_plane(0.0, dist=2.0)  # 2 mm per px at f=1000
    img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(img).line([(170, 240), (470, 240)], fill=255, width=3)  # 300 px long, 3 px wide
    m = raycast_metrology(np.asarray(img) > 0, depth, K, "concrete crack")
    assert m.inclination_deg < 0.5
    assert abs(m.length_m - 0.6) < 0.03
    assert 4.0 <= m.max_width_mm <= 8.0  # 3 px ≈ 6 mm, medial-axis quantised


def test_host_scale_metrology_on_pier():
    pier = next(c for a in build_corridor() for c in a.components if c.id == "B07.P4")
    ref = scale_ref_for(pier)
    assert ref == ScaleRef(component_id="B07.P4", component_name="Pier 4", axis="width", length_m=2.4)

    host = np.zeros((600, 400), bool)
    host[:, 80:320] = True  # pier spans 240 px -> 10 mm/px
    assert host_extent_px(host, "width") == 240
    crack = np.zeros_like(host)
    crack[300:302, 100:250] = True  # 150 px long, 2 px wide
    m = host_scale_metrology(crack, "alligator crack", host, ref)
    assert m.scale_mm_per_px == 10.0
    assert abs(m.area_m2 - 300 * 1e-4) < 1e-9
    assert abs(m.length_m - 1.5) < 0.05
    assert m.max_width_mm >= 10.0 and m.inclination_deg is None


def test_scale_refs_by_kind():
    comps = {c.id: c for a in build_corridor() for c in a.components}
    assert scale_ref_for(comps["B07.G3"]).axis == "height" and scale_ref_for(comps["B07.G3"]).length_m == 2.2
    assert scale_ref_for(comps["T02.R2"]) is None  # curved lining: no planar reference yet
    assert scale_ref_for(comps["B07.WX"]) is None
    assert host_scale_metrology(np.ones((5, 5), bool), "crack", np.ones((3, 3), bool), scale_ref_for(comps["B07.P1"])) is None


def test_plausibility_warnings():
    ref = ScaleRef(component_id="B07.P4", component_name="Pier 4", axis="width", length_m=2.4)
    host = np.zeros((600, 400), bool)
    host[:, 80:320] = True
    ok = np.zeros_like(host)
    ok[300:302, 100:250] = True
    assert host_scale_metrology(ok, "concrete crack", host, ref).warnings == []
    m = host_scale_metrology(host.copy(), "concrete crack", host, ref)  # "crack" == whole pier
    assert len(m.warnings) == 2 and "implausible" in m.warnings[0] and "100%" in m.warnings[1]
