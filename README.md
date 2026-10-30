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
  app/meta_client.py  Meta Model API client (Responses API)
frontend/           Vite + React 19 + TypeScript + Tailwind v4
  src/components/     CorridorMap, TwinViewer, Inspector, AlertsFeed, Sparkline
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
