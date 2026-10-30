# Modal GPU workers

Open-weight Meta models served on Modal (serverless GPU):

- `sam3d_service.py` (Feature 3): `facebook/sam-3d-objects` → `/reconstruct-defect` (.glb mesh + R, t, s layout)
  and `facebookresearch/sam-3d-body` → `/localize-worker` (work-zone geofencing).
