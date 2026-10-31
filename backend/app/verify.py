"""Independent metrology check: Muse Spark Open writes and runs its own measurement code.

Spark Open receives a pinned defect's mask (preloaded as a numpy array) and metric scale, writes
Python to measure it from scratch, runs it through the run_python tool (a network-isolated Modal
Sandbox), iterates on errors, then compares its numbers with the twin's metrology and explains
any disagreement. Its interim messages / reasoning form the commentary shown in the UI.
"""

import json
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from pydantic import BaseModel

from .findings import Finding
from .openweight import spark_open
from .sandbox import SandboxResult

MAX_ROUNDS = 4

PRELUDE = """import base64, io, json
import numpy as np
from PIL import Image
mask = np.asarray(Image.open(io.BytesIO(base64.b64decode({mask_b64!r}))).split()[-1]) > 127
MM_PER_PX = {mm_per_px!r}
"""

SYSTEM = """You are a structural inspection metrologist verifying a defect measurement independently.
A boolean numpy array `mask` (rows x cols, True = defect pixels) and the float `MM_PER_PX` are already defined
in the Python environment; numpy, scipy and scikit-image are installed, with no network. Use the run_python tool to
compute, from scratch: area_m2, perimeter_m and, for cracks, length_m (centre-line) and max_width_mm.
Print one JSON object from your code. Fix and re-run on errors. Then reply (no tool call) with JSON only:
{"independent": {"area_m2": number, "perimeter_m": number, "length_m": number|null, "max_width_mm": number|null},
 "agreement": "agree" | "minor_differences" | "disagree",
 "commentary": "<2-4 sentences comparing with the twin's values and explaining any difference by method>"}"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run Python 3.12 in an isolated sandbox with `mask` and `MM_PER_PX` predefined. Returns stdout, stderr, exit code.",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string", "description": "Python source to execute"}},
                "required": ["code"],
            },
        },
    }
]


class Run(BaseModel):
    code: str
    result: SandboxResult


class Verification(BaseModel):
    finding_id: str
    t: float
    model: str
    status: Literal["done", "error"]
    commentary: list[str] = []
    runs: list[Run] = []
    independent: dict[str, float | None] | None = None
    ours: dict[str, float | None]
    agreement: str | None = None
    summary: str | None = None
    error: str | None = None


def _ours(f: Finding) -> dict[str, float | None]:
    m = f.metrology
    return {"area_m2": m.area_m2, "perimeter_m": m.perimeter_m, "length_m": m.length_m, "max_width_mm": m.max_width_mm}


async def verify(f: Finding, run_python: Callable[[str], Awaitable[SandboxResult]]) -> Verification:
    assert f.metrology and f.metrology.scale_mm_per_px and f.mask_png
    prelude = PRELUDE.format(mask_b64=f.mask_png.split(",", 1)[1], mm_per_px=f.metrology.scale_mm_per_px)
    v = Verification(finding_id=f.id, t=time.time(), model=spark_open.model, status="done", ours=_ours(f))
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": json.dumps(
                {"defect": f.concept, "mm_per_px": f.metrology.scale_mm_per_px, "mask_shape_hint": "box-local crop", "twin_metrology": v.ours}
            ),
        },
    ]
    try:
        for _ in range(MAX_ROUNDS + 1):
            msg = await spark_open.chat(messages, tools=TOOLS, temperature=0.2)
            for text in (msg.get("reasoning_content"), msg.get("content") if msg.get("tool_calls") else None):
                if text and text.strip():
                    v.commentary.append(text.strip()[:1500])
            calls = msg.get("tool_calls") or []
            if not calls:
                content = msg.get("content") or ""
                data = json.loads(content[content.find("{") : content.rfind("}") + 1])
                v.independent = {k: (float(x) if x is not None else None) for k, x in data["independent"].items()}
                v.agreement = str(data.get("agreement"))
                v.summary = str(data.get("commentary", ""))
                return v
            messages.append({"role": "assistant", "content": msg.get("content"), "tool_calls": calls})
            for call in calls:
                code = json.loads(call["function"].get("arguments") or "{}").get("code", "")
                result = await run_python(prelude + "\n" + code)
                v.runs.append(Run(code=code, result=result))
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": result.model_dump_json()})
        raise RuntimeError(f"no final answer within {MAX_ROUNDS} tool rounds")
    except Exception as e:
        v.status, v.error = "error", f"{type(e).__name__}: {e}"[:500]
        return v
