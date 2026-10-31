# InfraTwin-Live

**Autonomous geo-anchored 3D structural health monitoring, defect metrology & UAV inspection digital twin.**

A browser-based command center that links a 3D GIS map of an infrastructure corridor to component-aware
structural twins, live sensor telemetry, Meta's SAM 3.1 / SAM 3D for defect segmentation and 3D lifting,
and Muse models for metrology, drone re-planning, voice logging and deterioration forecasts.

> Status: foundation in place; features are being added one by one. See [docs/ROADMAP.md](docs/ROADMAP.md).

## What runs today

- **Corridor map**: key-free satellite imagery plus 3D terrain (MapLibre), with health pins for a bridge, a tunnel and a dam
- **Structural twin**: a Three.js / R3F viewer where each BIM component is clickable and colored by live health (critical components pulse)
- **Live SHM telemetry**: a simulated strain, vibration, deflection, convergence, uplift and seepage stream over WebSocket.
  Health rolls up sensor → component → asset, with threshold hysteresis
- **Alerts feed**: watch and critical escalations. Click one to jump to the component
- **Demo trigger**: "Simulate Pier 4 event" ramps Pier 4 of viaduct B-07 into a critical state
- **SAM 3.1 inspection** (Inspection tab): one frame is segmented against two vocabularies, structural elements
  (pier, girder, deck…) and dacl10k surface defects (crack, spalling, exposed rebar…), fanned out concurrently.
  Each defect is attributed to the element its mask overlaps most, e.g. "concrete crack #0 on concrete pier #1 · 87%"
- **SAM 3.1 video tracking**: drone or walk-through clips are resampled to 5 fps and each defect is tracked across frames,
  with overlays synced to playback
- **Findings pinned to the twin**: confirmed defects are pinned to the component the frame was captured at. They show
  as patches on the 3D twin (selecting one zooms the camera there), as counts on the map pins, and as a thumbnail log
  in the inspector. Patch placement is approximate (taken from the 2D frame position) until SAM 3D lifting

## Quick start

Requirements: Node 20+, [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 automatically).

```bash
cp .env.example .env        # add MODEL_API_KEY from dev.meta.ai
./dev.sh                    # backend :8000 + frontend :5173
open http://localhost:5173
```

Check the Meta API key: `curl localhost:8000/api/meta/ping`

## Layout

```
backend/            FastAPI (Python 3.12, uv)
  app/main.py         REST + /ws/telemetry
  app/corridor.py     seed assets, components, sensors (placeholder BIM)
  app/simulator.py    telemetry sim, health roll-up, alerts, WS fan-out
  app/meta_client.py  Meta Model API client (Responses API, SSE streaming)
  app/sam31.py        SAM 3.1 dual-vocabulary segmentation + defect→element attribution
  app/sam31_video.py  clip transcoding (PyAV) + SAM 3.1 video tracking → per-defect tracks
  app/findings.py     findings pinned to components (persisted to backend/data/findings.json)
frontend/           Vite + React 19 + TypeScript + Tailwind v4
  src/components/     CorridorMap, TwinViewer, InspectionPanel, Inspector, AlertsFeed, Sparkline
modal_workers/      SAM 3D Objects / Body GPU services (coming)
docs/ROADMAP.md     feature plan + Meta API integration notes
```

## Research implemented (planned)

1. Hierarchical 3D damage visualization & digital-twin updating (arXiv:2602.16713)
2. Zero-shot foundation-model Scan-to-BIM via Union-Find (Elsaeed, TUM 2025)
3. Metric 3D defect quantification via normal-gradient raycasting (ASCE JCCE)
4. Occlusion-adaptive UAV infrastructure inspection, Algorithm 2 (arXiv:2605.11119)
5. dacl10k bridge defect taxonomy (arXiv:2506.14255)

All assets and sensor data in this demo are simulated.
