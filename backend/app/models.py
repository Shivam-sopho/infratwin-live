from typing import Literal

from pydantic import BaseModel

Status = Literal["nominal", "watch", "critical"]
STATUS_RANK: dict[str, int] = {"nominal": 0, "watch": 1, "critical": 2}


class Geometry(BaseModel):
    """Placeholder BIM primitive in asset-local metres (y up).

    box:      size = (width_x, height_y, depth_z)
    cylinder: size = (radius, height, 0)
    arch:     size = (radius, length_z, 0) — half-cylinder shell, axis along z
    arch_rib: size = (span_x, rise_y, thickness) — parabolic rib in the x-y plane, springing at position
    """

    shape: Literal["box", "cylinder", "arch", "arch_rib"]
    position: tuple[float, float, float]
    size: tuple[float, float, float]


class Sensor(BaseModel):
    id: str
    component_id: str
    kind: str
    label: str
    unit: str
    baseline: float
    watch: float
    critical: float


class Component(BaseModel):
    id: str
    asset_id: str
    name: str
    kind: str
    geometry: Geometry | None = None
    sensor_ids: list[str] = []


class Occluder(BaseModel):
    """Non-structural obstacle near the structure (pipes, scaffolding) that blocks camera views and flight."""

    id: str
    name: str
    kind: str
    geometry: Geometry


class Asset(BaseModel):
    id: str
    name: str
    type: Literal["bridge", "tunnel", "dam"]
    lng: float
    lat: float
    heading_deg: float = 0.0
    description: str
    components: list[Component]
    sensors: list[Sensor]
    occluders: list[Occluder] = []
    uav_home: tuple[float, float, float] | None = None  # drone launch point, asset-local metres
    region: str = "Pune corridor"
    data_source: Literal["simulated", "replay", "live"] = "simulated"
    data_note: str = "Simulated sensor data"


class Alert(BaseModel):
    id: str
    t: float
    level: Status
    asset_id: str
    component_id: str
    sensor_id: str
    value: float
    message: str
