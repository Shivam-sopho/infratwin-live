"""Time-travel previews: Muse Spark reasons about how a defect evolves, Muse Image renders it.

"Reason before render": Spark writes a short engineering narrative and a precise visual edit
prompt per scenario from the finding's type, measurements, host element and environment; Muse
Image then edits the actual defect photo. Outputs are illustrative visualisations, not predictions.
"""

import json
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .findings import Finding
from .meta_client import MUSE_IMAGE, MUSE_SPARK, meta

Scenario = Literal["6mo", "2y", "repair"]

SCENARIOS: dict[str, str] = {
    "6mo": "the same view after 6 months untreated (one wet season / freeze-thaw cycles, continued traffic loading)",
    "2y": "the same view after 2 years untreated (progressive deterioration: crack growth, spalling, corrosion staining)",
    "repair": "the same view after an appropriate repair for this defect type (e.g. epoxy injection for cracks, "
    "patch repair for spalling with rebar treatment, CFRP wrap for structural cracking), freshly completed",
}

INSTRUCTIONS = """You are a bridge/structures engineer preparing a visual forecast of a concrete defect for an
inspection report. Given the finding (defect type, measurements, host element, environment) and a scenario:
1. narrative: 2-3 sentences on what plausibly happens to this defect in the scenario and why (mechanism), grounded
   in the provided measurements; say clearly what is uncertain. For repairs, name the repair method and why it fits.
2. image_prompt: an edit instruction for an image model that will modify the supplied close-up photo. Keep the same
   camera viewpoint, framing, lighting and surrounding concrete; describe only the visible changes (crack width and
   branching, spall extent, rust staining, efflorescence, or the repaired surface finish). Photorealistic, no text,
   no annotations, no people."""


class ForecastPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    narrative: str
    image_prompt: str


class Forecast(BaseModel):
    finding_id: str
    scenario: Scenario
    t: float
    narrative: str
    image_prompt: str
    image_url: str
    models: list[str]


class ForecastStore:
    def __init__(self, root: Path):
        self.root = root

    def _paths(self, finding_id: str, scenario: str) -> tuple[Path, Path]:
        return self.root / f"{finding_id}_{scenario}.json", self.root / f"{finding_id}_{scenario}.jpg"

    def get(self, finding_id: str, scenario: str) -> Forecast | None:
        meta_path, img = self._paths(finding_id, scenario)
        if meta_path.exists() and img.exists():
            return Forecast.model_validate_json(meta_path.read_text())
        return None

    def image_path(self, finding_id: str, scenario: str) -> Path | None:
        _, img = self._paths(finding_id, scenario)
        return img if img.exists() else None

    def list(self, finding_id: str) -> list[Forecast]:
        return [f for s in SCENARIOS if (f := self.get(finding_id, s))]

    def save(self, fc: Forecast, image: bytes) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        meta_path, img = self._paths(fc.finding_id, fc.scenario)
        img.write_bytes(image)
        meta_path.write_text(fc.model_dump_json())


async def plan(finding: Finding, scenario: Scenario, context: dict) -> ForecastPlan:
    resp = await meta.respond(
        MUSE_SPARK,
        json.dumps(
            {
                "scenario": SCENARIOS[scenario],
                "finding": finding.for_prompt(exclude={"bbox_uv"}),
                **context,
            }
        ),
        instructions=INSTRUCTIONS,
        reasoning={"effort": "medium"},
        text={"format": {"type": "json_schema", "name": "forecast_plan", "schema": ForecastPlan.model_json_schema(), "strict": True}},
        store=False,
    )
    return ForecastPlan.model_validate_json(meta.output_text(resp))


async def render(store: ForecastStore, finding: Finding, scenario: Scenario, context: dict) -> Forecast:
    cached = store.get(finding.id, scenario)
    if cached:
        return cached
    p = await plan(finding, scenario, context)
    image = await meta.image_edit(p.image_prompt, finding.thumbnail)
    fc = Forecast(
        finding_id=finding.id,
        scenario=scenario,
        t=time.time(),
        narrative=p.narrative,
        image_prompt=p.image_prompt,
        image_url=f"/api/findings/{finding.id}/forecasts/{scenario}.jpg",
        models=[MUSE_SPARK, MUSE_IMAGE],
    )
    store.save(fc, image)
    return fc
