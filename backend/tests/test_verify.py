import asyncio
import base64
import io
import json
import subprocess
import sys
import time

import numpy as np
from PIL import Image

from app import verify as verify_mod
from app.findings import Finding
from app.metrology import Metrology
from app.sandbox import SandboxResult
from app.verify import verify

MEASURE = """
area = float(mask.sum()) * (MM_PER_PX / 1000) ** 2
print(json.dumps({"area_m2": area, "shape": list(mask.shape)}))
"""


def _mask_png(mask: np.ndarray) -> str:
    alpha = Image.fromarray(mask.astype(np.uint8) * 255, "L")
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    buf = io.BytesIO()
    rgba.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _finding():
    mask = np.zeros((20, 50), bool)
    mask[9:11, 5:45] = True  # 80 px
    return Finding(
        id="FD-0001", t=time.time(), asset_id="B07", component_id="B07.P4", concept="concrete crack", confidence=0.9,
        area_px=80, source="image", source_name="p4.jpg", bbox_uv=(0.1, 0.1, 0.2, 0.2), thumbnail="data:image/jpeg;base64,AA",
        mask_png=_mask_png(mask),
        metrology=Metrology(method="host-scale-2d", scale_mm_per_px=10.0, scale_note="x", area_m2=0.008, perimeter_m=0.84,
                            length_m=0.4, max_width_mm=20.0, assumptions=[]),
    )


async def local_test_runner(code: str) -> SandboxResult:
    """Test-only stand-in for the Modal Sandbox: runs test-authored code in a subprocess."""
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
    return SandboxResult(stdout=p.stdout, stderr=p.stderr, exit_code=p.returncode, ms=1)


def test_spark_open_tool_loop_runs_code_against_real_mask(monkeypatch):
    seen = []

    async def fake_chat(messages, **kw):
        seen.append(messages[-1])
        if len(seen) == 1:
            return {"content": "Measuring area first.", "reasoning_content": "Plan: count pixels, scale by mm/px.",
                    "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "run_python", "arguments": json.dumps({"code": MEASURE})}}]}
        out = json.loads(json.loads(messages[-1]["content"])["stdout"])
        final = {"independent": {"area_m2": out["area_m2"], "perimeter_m": 0.85, "length_m": 0.4, "max_width_mm": 20.0},
                 "agreement": "agree", "commentary": f"Pixel count matches; mask shape {out['shape']}."}
        return {"content": json.dumps(final)}

    monkeypatch.setattr(verify_mod.spark_open, "chat", fake_chat)
    monkeypatch.setattr(verify_mod.spark_open, "model", "muse-spark-open-test")
    v = asyncio.run(verify(_finding(), local_test_runner))

    assert v.status == "done", v.error
    assert v.runs[0].result.exit_code == 0
    assert abs(v.independent["area_m2"] - 0.008) < 1e-9  # 80 px at 10 mm/px, decoded from the PNG mask
    assert "[20, 50]" in v.summary and v.agreement == "agree"
    assert v.commentary == ["Plan: count pixels, scale by mm/px.", "Measuring area first."]
    assert seen[1]["role"] == "tool" and seen[1]["tool_call_id"] == "call_1"


def test_verify_reports_errors(monkeypatch):
    async def bad_chat(messages, **kw):
        return {"content": "I cannot do that."}

    monkeypatch.setattr(verify_mod.spark_open, "chat", bad_chat)
    v = asyncio.run(verify(_finding(), local_test_runner))
    assert v.status == "error" and v.independent is None
