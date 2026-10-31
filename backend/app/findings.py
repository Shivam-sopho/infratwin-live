"""Inspection findings pinned to twin components (persisted to a local JSON file)."""

import itertools
import json
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .metrology import Metrology

MAX_THUMBNAIL_CHARS = 300_000


class FindingIn(BaseModel):
    component_id: str
    concept: str = Field(max_length=100)
    confidence: float | None = None
    area_px: int = Field(ge=0)
    source: Literal["image", "video"]
    source_name: str = Field(max_length=200)
    # Defect box normalised to the frame (0..1). Placement on the twin face is approximate
    # until SAM 3D lifting provides real camera pose.
    bbox_uv: tuple[float, float, float, float]
    host_label: str | None = Field(default=None, max_length=100)
    frames_tracked: int | None = None
    metrology: Metrology | None = None
    mask_png: str | None = None  # box-local defect mask (white RGBA, alpha = mask) for independent re-measurement
    thumbnail: str

    @field_validator("thumbnail")
    @classmethod
    def _thumb(cls, v: str) -> str:
        if not v.startswith("data:image/") or len(v) > MAX_THUMBNAIL_CHARS:
            raise ValueError("thumbnail must be an image data URL under 300 kB")
        return v

    @field_validator("mask_png")
    @classmethod
    def _mask(cls, v: str | None) -> str | None:
        if v is not None and (not v.startswith("data:image/png;base64,") or len(v) > MAX_THUMBNAIL_CHARS):
            raise ValueError("mask_png must be a PNG data URL under 300 kB")
        return v

    @model_validator(mode="after")
    def _uv(self):
        u1, v1, u2, v2 = self.bbox_uv
        if not (0 <= u1 < u2 <= 1 and 0 <= v1 < v2 <= 1):
            raise ValueError("bbox_uv must be ordered and within 0..1")
        return self


class Finding(FindingIn):
    id: str
    t: float
    asset_id: str


class FindingStore:
    def __init__(self, path: Path):
        self.path = path
        self._items: dict[str, Finding] = {}
        if path.exists():
            for raw in json.loads(path.read_text()):
                f = Finding.model_validate(raw)
                self._items[f.id] = f
        start = max((int(i.split("-")[1]) for i in self._items), default=0) + 1
        self._ids = itertools.count(start)

    def all(self) -> list[Finding]:
        return list(self._items.values())

    def add(self, items: list[FindingIn], asset_of: dict[str, str]) -> list[Finding]:
        now = time.time()
        added = [
            Finding(**i.model_dump(), id=f"FD-{next(self._ids):04d}", t=now, asset_id=asset_of[i.component_id])
            for i in items
        ]
        self._items.update({f.id: f for f in added})
        self._save()
        return added

    def remove(self, finding_id: str) -> bool:
        if self._items.pop(finding_id, None) is None:
            return False
        self._save()
        return True

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps([f.model_dump() for f in self._items.values()]))
        tmp.replace(self.path)
