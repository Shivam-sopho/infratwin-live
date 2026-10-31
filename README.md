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
- **Defect metrology**: choosing where a frame was captured (e.g. Pier 4, 2.4 m wide) gives a metric scale from that
  element's SAM 3.1 mask. Each defect then gets area, perimeter, and, for cracks, length and max/mean width (skeleton
  plus distance transform), with stated assumptions and plausibility warnings. The normal-gradient plane raycasting
  method (depth gradients → surface normal → ray/plane intersection, giving true area and inclination) is implemented
  and validated on synthetic tilted planes, ready for SAM 3D depth
- **UAV re-scan planner (Muse Wonder + Algorithm 2)**: obstacles such as drainage pipes and scaffolding are part of
  the twin. The geometry engine samples the defect region, scores camera poses by line-of-sight coverage and viewing
  angle, and plans collision-checked flights. Muse Wonder calls these as tools, compares standoffs, and returns a
  mission plan. The twin and the map show candidate poses, the chosen camera and the flight path (e.g. a crack behind
  the downpipe: 30% visible square-on → 90% from yaw −30°)
- **Voice field commands**: push-to-talk in the browser. Muse Voice Transcribe, biased with the twin's component and
  defect vocabulary, feeds Muse Spark, which turns speech into actions. E.g. *"Pin this shear crack to Pier 4, run
  metric area calculation, and plan a drone re-scan around the drainage pipe"* → field note + measurements + Wonder
  mission + focus on Pier 4
- **Time-travel previews (Muse Spark → Muse Image)**: for a pinned defect, drag the timeline to +6 months, +2 years
  or *Repaired*. Muse Spark first reasons about the mechanism from the defect's type, measurements and environment,
  and writes a precise edit prompt; Muse Image then edits the actual inspection photo. Results are cached and
  labelled as illustrative visualisations, not predictions
- **Muse Glimmer first-pass screening**: every watch or critical alert is screened by Glimmer (open weights,
  served from any OpenAI-compatible endpoint such as vLLM on Modal or OpenRouter) as structural, sensor fault,
  environmental or uncertain, with an escalate flag, shown on the alert
- **Cognitive Twin (Muse Spark)**: when a sensor goes critical, the twin hands Muse Spark the component's live traces,
  thresholds, neighbouring sensor states, recent alerts and pinned findings. Its reasoning streams into the panel,
  followed by a structured assessment: severity, causes, evidence, actions, and whether a visual audit is needed
  (which opens the inspection tab on that component)

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
  app/triage.py       Cognitive Twin: alert context assembly + streamed Muse Spark triage
  app/metrology.py    host-scale defect measurement + normal-gradient plane raycasting
  app/uav_planner.py  Algorithm 2 view scoring (ray/AABB occlusion) + collision-checked flight paths
  app/missions.py     Muse Wonder mission planning with the planner as function tools
  app/voice.py        Voice Transcribe + Muse Spark intent parsing, field notes
  app/forecast.py     reason-before-render time-travel previews (Muse Spark + Muse Image)
  app/openweight.py   OpenAI-compatible clients for Muse Glimmer / Muse Spark Open
  app/screening.py    Glimmer first-pass alert screening
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
