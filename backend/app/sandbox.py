"""Isolated execution of model-written code in a Modal Sandbox.

Model-generated code is never executed on this machine: without Modal credentials the feature is
unavailable. Sandboxes run with networking blocked, bounded CPU/memory and a hard timeout.
"""

import os
import time
from pathlib import Path

import modal
from pydantic import BaseModel

SANDBOX_APP = "infratwin-sandbox"
TIMEOUT_S = 90
MAX_OUTPUT_CHARS = 20_000

IMAGE = modal.Image.debian_slim(python_version="3.12").pip_install("numpy", "scipy", "scikit-image", "pillow")


class SandboxResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int | None
    ms: int


def modal_configured() -> bool:
    return bool(os.environ.get("MODAL_TOKEN_ID")) or (Path.home() / ".modal.toml").exists()


async def run_python(code: str) -> SandboxResult:
    t0 = time.perf_counter()
    app = await modal.App.lookup.aio(SANDBOX_APP, create_if_missing=True)
    sb = await modal.Sandbox.create.aio(
        "python", "-c", code, app=app, image=IMAGE, timeout=TIMEOUT_S, block_network=True, cpu=1.0, memory=1024
    )
    try:
        await sb.wait.aio(raise_on_termination=False)
        stdout = await sb.stdout.read.aio()
        stderr = await sb.stderr.read.aio()
        return SandboxResult(
            stdout=stdout[-MAX_OUTPUT_CHARS:],
            stderr=stderr[-MAX_OUTPUT_CHARS:],
            exit_code=sb.returncode,
            ms=int((time.perf_counter() - t0) * 1000),
        )
    finally:
        await sb.terminate.aio()
