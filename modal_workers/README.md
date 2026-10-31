# Modal GPU workers

`sam3d_service.py` serves the open-weight SAM 3D models on Modal GPUs:

| Endpoint label | Model | GPU | Input → output |
|---|---|---|---|
| `sam3d-reconstruct-defect` | `facebook/sam-3d-objects` | A100-40GB (needs ≥32 GB) | image + mask → Gaussian point cloud (xyz + rgb) and camera-frame pose (R, t, s) |
| `sam3d-localize-workers` | `facebook/sam-3d-body-dinov3` | A10G | image → people with camera-frame translation, bbox, 3D keypoints |

Both endpoints require Modal proxy auth (`Modal-Key` / `Modal-Secret` headers).

## Deploy

```bash
# 1. Hugging Face: request access to both gated repos, then create a read token
#    https://huggingface.co/facebook/sam-3d-objects
#    https://huggingface.co/facebook/sam-3d-body-dinov3
modal secret create huggingface HF_TOKEN=<token>

# 2. Download checkpoints into the shared Volume (once)
modal run modal_workers/sam3d_service.py::download_weights

# 3. Deploy; prints the two endpoint URLs
modal deploy modal_workers/sam3d_service.py

# 4. Create a proxy auth token: Modal dashboard → Settings → Proxy Auth Tokens
```

Then set in `.env`:

```
SAM3D_OBJECTS_URL=https://<workspace>--sam3d-reconstruct-defect.modal.run
SAM3D_BODY_URL=https://<workspace>--sam3d-localize-workers.modal.run
MODAL_PROXY_KEY=wk-...
MODAL_PROXY_SECRET=ws-...
```

## Status

The service follows the official setup docs (CUDA 12.1, PyTorch 2.5.1, PyTorch3D compiled on a GPU, Kaolin
wheels, the Hydra patch) and its definitions load against the Modal client. It has **not yet been built or
run on a GPU**: expect to fix image-build details on first deploy. Notes:

- The first image build compiles PyTorch3D on an A10G and takes a while; later deploys are cached.
- Output field names are read defensively (`gs` or `gaussian[0]`; `pred_cam_t`/`cam_t`) and each response
  includes `keys` listing what the model actually returned, to make the first real run easy to adapt.
- Cold starts load multi-GB checkpoints; the backend allows up to 10 minutes per call.

`../backend/app/sandbox.py` also uses Modal (Sandboxes, CPU only) for the Spark Open measurement check.
It needs only `modal token new`, with no deploy step.
