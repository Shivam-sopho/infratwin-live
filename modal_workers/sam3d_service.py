"""SAM 3D Objects + SAM 3D Body as Modal GPU endpoints.

Deploy:
    modal secret create huggingface HF_TOKEN=<token with access to the gated repos>
    modal run modal_workers/sam3d_service.py::download_weights     # once, into a Modal Volume
    modal deploy modal_workers/sam3d_service.py

Endpoints (proxy-auth protected; send Modal-Key / Modal-Secret headers):
    POST <objects-url>  {"image_b64": <png/jpeg>, "mask_b64": <png, alpha or luminance = mask>, "max_points": 40000}
        -> {"points_b64": float32 xyzrgb, "n": int, "rotation": [...], "translation": [...], "scale": [...], "keys": [...]}
    POST <body-url>     {"image_b64": <png/jpeg>}
        -> {"people": [{"cam_t": [x, y, z], "bbox": [...], "keypoints_3d": [[x, y, z], ...]}], "keys": [...]}

Install steps follow facebookresearch/sam-3d-objects doc/setup.md and sam-3d-body INSTALL.md.
"""

import base64
import io
import os

import modal

app = modal.App("infratwin-sam3d")
hf_secret = modal.Secret.from_name("huggingface")
weights = modal.Volume.from_name("sam3d-weights", create_if_missing=True)
WEIGHTS = "/weights"

CUDA_BASE = "nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04"

objects_image = (
    modal.Image.from_registry(CUDA_BASE, add_python="3.11")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0", "ninja-build")
    .run_commands("git clone --depth 1 https://github.com/facebookresearch/sam-3d-objects /opt/sam-3d-objects")
    .env(
        {
            "PIP_EXTRA_INDEX_URL": "https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121",
            "PIP_FIND_LINKS": "https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html",
            "TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0",
        }
    )
    .run_commands("cd /opt/sam-3d-objects && pip install -e '.[dev]'")
    # PyTorch3D must be compiled with GPU support (setup.md), so build on a GPU node.
    .run_commands("cd /opt/sam-3d-objects && pip install -e '.[p3d]'", gpu="A10G")
    .run_commands("cd /opt/sam-3d-objects && pip install -e '.[inference]' && ./patching/hydra")
    .pip_install("fastapi[standard]", "huggingface-hub[cli]<1.0", "pillow", "numpy")
)

body_image = (
    modal.Image.from_registry(CUDA_BASE, add_python="3.11")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.5.1", "torchvision==0.20.1", index_url="https://download.pytorch.org/whl/cu121")
    .run_commands("git clone --depth 1 https://github.com/facebookresearch/sam-3d-body /opt/sam-3d-body")
    .run_commands("cd /opt/sam-3d-body && pip install -r requirements.txt || true")
    .run_commands(
        "pip install 'git+https://github.com/facebookresearch/detectron2.git@a1ce2f9' --no-build-isolation --no-deps",
        "pip install git+https://github.com/microsoft/MoGe.git",
        gpu="A10G",
    )
    .pip_install("fastapi[standard]", "huggingface-hub[cli]<1.0", "opencv-python-headless", "pillow", "numpy")
)

download_image = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface-hub[cli]<1.0")


@app.function(image=download_image, volumes={WEIGHTS: weights}, secrets=[hf_secret], timeout=3600)
def download_weights():
    """Fetch the gated checkpoints once into the shared Volume (layout per the repos' docs)."""
    import shutil
    import subprocess

    tok = os.environ["HF_TOKEN"]
    objs = f"{WEIGHTS}/sam-3d-objects"
    if not os.path.exists(f"{objs}/hf/pipeline.yaml"):
        dl = f"{objs}/hf-download"
        subprocess.run(
            ["hf", "download", "facebook/sam-3d-objects", "--repo-type", "model", "--local-dir", dl, "--max-workers", "1", "--token", tok],
            check=True,
        )
        os.makedirs(objs, exist_ok=True)
        shutil.move(f"{dl}/checkpoints", f"{objs}/hf")
        shutil.rmtree(dl, ignore_errors=True)
    body = f"{WEIGHTS}/sam-3d-body-dinov3"
    if not os.path.exists(f"{body}/model.ckpt"):
        subprocess.run(["hf", "download", "facebook/sam-3d-body-dinov3", "--local-dir", body, "--token", tok], check=True)
    weights.commit()


def _decode_image(b64: str):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"), dtype=np.uint8)


def _decode_mask(b64: str):
    import numpy as np
    from PIL import Image

    im = Image.open(io.BytesIO(base64.b64decode(b64)))
    channel = im.split()[-1] if im.mode in ("RGBA", "LA") else im.convert("L")
    return np.asarray(channel) > 127


def _val(obj, name):
    """Gaussian attributes are properties in some releases and methods in others."""
    v = getattr(obj, name)
    return v() if callable(v) else v


def _tolist(x, limit=200_000):
    import numpy as np

    if hasattr(x, "detach"):
        x = x.detach().float().cpu().numpy()
    arr = np.asarray(x)
    return arr.reshape(-1)[:limit].tolist() if arr.size > limit else arr.tolist()


@app.cls(image=objects_image, gpu="A100-40GB", volumes={WEIGHTS: weights}, scaledown_window=300, timeout=600)
class SAM3DObjects:
    @modal.enter()
    def load(self):
        import sys

        sys.path.append("/opt/sam-3d-objects/notebook")
        os.chdir("/opt/sam-3d-objects")
        from inference import Inference

        self.inference = Inference(f"{WEIGHTS}/sam-3d-objects/hf/pipeline.yaml", compile=False)

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, label="sam3d-reconstruct-defect")
    def reconstruct(self, req: dict):
        import numpy as np

        image, mask = _decode_image(req["image_b64"]), _decode_mask(req["mask_b64"])
        if mask.shape != image.shape[:2]:
            from PIL import Image

            mask = np.asarray(Image.fromarray(mask).resize((image.shape[1], image.shape[0]), Image.NEAREST))
        out = self.inference(image, mask, seed=int(req.get("seed", 42)))

        gs = out["gs"] if "gs" in out else out["gaussian"][0]
        xyz = _val(gs, "get_xyz").detach().float().cpu().numpy()
        try:
            dc = _val(gs, "get_features").detach().float().cpu().numpy().reshape(len(xyz), -1)[:, :3]
            rgb = np.clip(0.5 + 0.28209479 * dc, 0, 1)  # SH degree-0 -> RGB
        except Exception:
            rgb = np.full_like(xyz, 0.6)
        n_max = int(req.get("max_points", 40000))
        if len(xyz) > n_max:
            idx = np.random.default_rng(0).choice(len(xyz), n_max, replace=False)
            xyz, rgb = xyz[idx], rgb[idx]
        pts = np.concatenate([xyz, rgb], axis=1).astype(np.float32)
        return {
            "points_b64": base64.b64encode(pts.tobytes()).decode(),
            "n": int(len(pts)),
            "rotation": _tolist(out.get("rotation", [])),
            "translation": _tolist(out.get("translation", [])),
            "scale": _tolist(out.get("scale", [])),
            "keys": sorted(map(str, out.keys())),
        }


@app.cls(image=body_image, gpu="A10G", volumes={WEIGHTS: weights}, scaledown_window=300, timeout=600)
class SAM3DBody:
    @modal.enter()
    def load(self):
        import sys

        sys.path.append("/opt/sam-3d-body")
        os.chdir("/opt/sam-3d-body")
        from notebook.utils import setup_sam_3d_body

        self.estimator = setup_sam_3d_body(hf_repo_id="facebook/sam-3d-body-dinov3")

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, label="sam3d-localize-workers")
    def localize(self, req: dict):
        image = _decode_image(req["image_b64"])
        outputs = self.estimator.process_one_image(image)
        people = outputs if isinstance(outputs, list) else [outputs]
        result = []
        for p in people:
            if not isinstance(p, dict):
                continue
            cam_t = p.get("pred_cam_t", p.get("cam_t"))
            result.append(
                {
                    "cam_t": _tolist(cam_t) if cam_t is not None else None,
                    "bbox": _tolist(p["bbox"]) if "bbox" in p else None,
                    "keypoints_3d": _tolist(p["pred_keypoints_3d"])[:70] if "pred_keypoints_3d" in p else None,
                    "focal_length": _tolist(p["focal_length"]) if "focal_length" in p else None,
                }
            )
        keys = sorted({str(k) for p in people if isinstance(p, dict) for k in p})
        return {"people": result, "keys": keys}
