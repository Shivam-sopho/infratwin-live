# InfraTwin-Live

**A live 3D digital twin for bridges, tunnels and dams that watches structural sensors, inspects drone and
camera footage with AI, measures defects, and plans the next inspection, built on Meta's SAM and Muse models.**

An engineer opens a 3D map of their assets. Each structure is a twin made of clickable members (piers, girders,
arches) coloured by live health. When sensors drift, the twin works out whether it is the weather or the
structure. When something looks wrong, it inspects photos and video, pins each defect to the member it sits on,
measures it in millimetres, and plans a drone flight that can actually see it.

---

## The workflow

| Step | What happens | Models |
|---|---|---|
| **1 · Monitor** | Live sensors stream into the twin; health rolls up sensor → member → asset; alerts fire with hysteresis | — |
| **2 · Screen & assess** | Every alert is screened in milliseconds; critical ones get a full engineering assessment that streams its reasoning | Muse Glimmer, Muse Spark 1.3 |
| **3 · Inspect** | Photos or video are segmented into structural elements *and* defects in one pass; each defect is pinned to its member | SAM 3.1 |
| **4 · Measure** | Defects get metric area, perimeter, crack length and width; a second model re-measures with its own code in a sandbox | Muse Spark Open |
| **5 · Lift to 3D** | The defect is reconstructed in 3D on the twin; workers under an overhead defect are flagged | SAM 3D Objects, SAM 3D Body |
| **6 · Plan the re-scan** | When a pipe or scaffold blocks the view, a planner finds camera angles that see the defect and a collision-free flight | Muse Wonder |
| **7 · Communicate** | Hands-free voice commands in the field; a timeline shows the defect in 2 years untreated vs. repaired | Muse Voice Transcribe, Muse Spark, Muse Image |

---

## What is real and what is simulated

The app labels every asset's data source on screen.

| | Status |
|---|---|
| **KW51 railway bridge, Leuven**: modal frequencies, temperatures, humidity, wind | **Real measurements**, Oct 2018 – Jan 2020, replayed (KU Leuven, [Zenodo 3745914](https://zenodo.org/record/3745914)) |
| **The 2019 strengthening of KW51 that the twin detects** | **Real event** in the real data |
| **Inspection sample photos** | **Real** bridge-inspection photos with expert labels ([dacl10k](https://huggingface.co/datasets/Voxel51/dacl10k)) |
| **Map imagery and terrain** | **Real** (Esri, AWS terrain tiles) |
| **SAM / Muse outputs** | **Real model output** when API keys are configured; nothing is faked without them |
| KW51 "deviation (σ)" sensors | **Derived**: real frequency minus the twin's temperature model |
| Defect measurements | **Derived** from the image and the member's known size |
| Pune corridor: viaduct B-07, tunnel T-02, dam D-01 | **Simulated** assets and sensor streams (labelled "Simulated sensor data") |
| "Simulate Pier 4 event" | **Simulated** demo trigger |
| 3D shapes of all structures, KW51 map position, drone obstacles | **Illustrative / approximate** |

---

## Features

### Live monitoring

- **3D map**: satellite imagery with 3D terrain (MapLibre, no API key needed), a health pin per asset with defect
  counts and a "real data" tag, an asset switcher across regions, and drone flight paths drawn on the ground.
- **Component-aware 3D twin** (Three.js / React Three Fiber): every member is clickable and coloured by health;
  critical members pulse; selecting a member, a defect or a mission flies the camera to it.
- **Telemetry and health**: readings stream over a WebSocket at 2 Hz. Status rolls up sensor → member → asset,
  with a 5% hysteresis margin so readings near a threshold don't spam alerts. Each member's sensors show live
  sparklines with their thresholds.
- **Real bridge data, KW51**: 15.5 months of hourly data replayed at adjustable speed (play/pause, 6 h/s to
  1 week/s, jump to before/after the retrofit). Natural frequencies drift with temperature and jump when ballast
  freezes, so raw thresholds would be useless. The twin fits `f = a + b·T + c·min(T, 0)` per mode on pre-retrofit
  data and watches the 6-hour smoothed robust z-score of the residual. On the real record:

  | Mode | Hours > 5σ before the retrofit | Hours > 5σ after the retrofit |
  |---|---|---|
  | 6 | 0.8 % | **97 %** |
  | 9 | 0.0 % | **97 %** |
  | 13 | 2.2 % | **89 %** |
  | 3 (barely affected) | 0.8 % | 0 % |

  The twin detects the real strengthening of the bridge from data alone, with about 1 % false alarms beforehand.
- **Sensor ingest API**: a gateway can push readings (`POST /api/ingest`, token-authenticated). They override
  the simulator or replay for those sensors, which is the path from demo to live deployment.
- **Muse Glimmer first-pass screening**: each watch/critical alert is classified as structural, sensor fault,
  environmental or uncertain, with an escalate flag, from the sensor's trace and its sibling sensors.
- **Cognitive Twin (Muse Spark 1.3)**: on a critical alert, Muse Spark receives the member's traces against
  thresholds, neighbouring members' states, weather, recent alerts and pinned inspection findings (including their
  measurements). Its reasoning summary streams live, then a schema-constrained assessment appears: severity,
  likely causes, evidence, recommended actions, and whether a visual audit is needed. A 2-minute cooldown per
  member avoids duplicate calls.

### AI inspection

- **SAM 3.1 on photos**: one image is segmented against two vocabularies at once: structural elements (pier,
  girder, deck, column, tunnel lining) and defects (crack, alligator crack, spalling, exposed rebar,
  efflorescence, rust stain, wet spot). SAM 3.1 takes one concept per request, so the requests fan out
  concurrently. Each defect is attributed to the element its mask overlaps most, e.g. *"concrete crack #0 on
  concrete pier #1 · 87 %"*.
- **SAM 3.1 on video**: clips are re-encoded to 5 fps / ≤20 s / ≤960 px (keeping phone rotation) so per-frame
  billing stays predictable. Every defect is tracked across frames with overlays synced to playback; click a row
  to jump to its clearest frame.
- **Real sample library with ground truth**: 24 real dacl10k inspection photos load in one click with the
  experts' boxes overlaid. After a SAM 3.1 run, a per-class table shows how many labelled defects SAM 3.1 found
  zero-shot.
- **Findings pinned to the twin**: confirmed defects are pinned to the member the photo was taken of. They appear
  as patches on the twin, as counts on the map, and as an inspection log with thumbnails in the inspector.
- **Metric measurement**: choosing where a photo was captured (e.g. Pier 4, 2.4 m wide) gives the scale from that
  member's mask. Each defect gets area, perimeter (sub-pixel contours) and, for cracks, centre-line length and
  max/mean width (skeleton + distance transform). Assumptions are stated, and plausibility warnings flag e.g.
  "cracks" wider than 50 mm. A full **plane-raycasting** method (depth gradients → surface normal → pixel rays
  intersected with the fitted plane → true area, perimeter and inclination) is implemented and validated on
  synthetic tilted planes (inclination exact, area within 3 % up to 55°). It switches on once SAM 3D supplies depth.
- **Independent check (Muse Spark Open + Modal Sandbox)**: Spark Open gets the defect mask and scale, writes its
  own measurement code, runs it in a network-isolated Modal Sandbox, and compares its numbers with the twin's.
  Model-written code never runs on the app server.
- **SAM 3D Objects / Body**: *Lift to 3D* reconstructs a pinned defect as a point cloud with pose, shown on the
  twin. The *Work-zone check* localises people (SAM 3D Body) and the defect (SAM 3D Objects) in the same camera
  frame and flags anyone within the exclusion radius below an overhead defect. Runs as Modal GPU endpoints;
  see [modal_workers/README.md](modal_workers/README.md).

### Planning and communication

- **Occlusion-adaptive drone re-scan (Muse Wonder)**: pipes and scaffolding are part of the twin. A geometry
  engine samples the defect region, scores camera poses (yaw, pitch, standoff) by line-of-sight coverage
  (vectorised ray/box tests against every member and obstacle) and viewing angle, and plans flights with
  clearance-checked detours. Muse Wonder calls these as **function tools**, compares options, and returns a
  mission plan with gimbal and safety notes. Example: a crack behind the drainage downpipe is **30 % visible
  square-on and 90 % visible at yaw −30°**. Candidate poses, the chosen camera, the path and an animated drone
  appear on the twin, and the path is drawn on the map.
- **Voice field commands**: push-to-talk in the browser (recorded and converted to 24 kHz WAV client-side), Muse
  Voice Transcribe biased with the twin's member and defect names, and Muse Spark turning speech into actions.
  *"Pin this shear crack to Pier 4, run metric area calculation, and plan a drone re-scan around the drainage
  pipe"* produces a field note, reads out the measurements, starts a Wonder mission and focuses Pier 4.
- **Time-travel previews**: drag a pinned defect's timeline to +6 months, +2 years or *Repaired*. Muse Spark
  first reasons about the mechanism from the defect's type, size and environment and writes a precise edit
  prompt; Muse Image then edits the actual inspection photo. Results are cached and labelled as illustrative
  visualisations, not engineering predictions.

### Product and operations

- **Access control**: set `APP_ACCESS_TOKEN` and the UI asks for it. Every API call and the telemetry socket then
  require it (HttpOnly cookie for browsers, `Authorization: Bearer` for gateways).
- **Spend guard**: every paid model call reserves its estimated cost first. Above `MAX_DAILY_USD` calls are
  refused with 429. Today's spend shows in the top bar.
- **Single container**: the backend serves the built UI, the API and the WebSocket from one origin
  (multi-stage Dockerfile, non-root, `/data` volume, health check).
- **Graceful degradation**: each model is optional. Missing keys show "not configured" instead of failing, and
  the top bar shows which models are live.
- **Demo walkthrough**: a *Demo* panel with six narrated steps and one-click setup, plus *Reset* to clear live
  state between takes (pinned findings are kept).

---

## Meta models

| Model | How it is called | Role |
|---|---|---|
| **SAM 3.1** | Meta Model API (Responses API, SSE, `meta-sam-parser`) | Element + defect segmentation and video tracking |
| **Muse Spark 1.3** | Meta Model API (Responses API, reasoning summaries, strict JSON schema) | Alert triage, voice intent parsing, time-travel reasoning |
| **Muse Wonder** | Meta Model API (Responses API, function tools, `previous_response_id`) | Drone mission planning with the geometry engine as tools |
| **Muse Image** | Meta Model API (`/images/edits`) | Deterioration and repair previews |
| **Muse Voice Transcribe** | Meta Model API (`/asr/transcribe`) | Field voice commands |
| **Muse Glimmer** | Any OpenAI-compatible endpoint (vLLM on Modal, OpenRouter, Together, Fireworks) | First-pass alert screening |
| **Muse Spark Open** | Any OpenAI-compatible endpoint + Modal Sandbox | Independent re-measurement with its own code |
| **SAM 3D Objects** | Modal GPU endpoint (`modal_workers/`) | Defect 3D reconstruction + pose |
| **SAM 3D Body** | Modal GPU endpoint (`modal_workers/`) | Worker localisation for work-zone safety |

**Verification status:** every integration follows Meta's documentation and is covered by tests against recorded
or stubbed responses, and every UI flow has been exercised in a browser with stubbed models. The paid APIs and the
SAM 3D GPU service have not yet been called live from this repository; expect small adjustments on first contact.

---

## Quick start (development)

Requirements: Node 20+ and [uv](https://docs.astral.sh/uv/) (uv installs Python 3.12 automatically).

```bash
cp .env.example .env          # add MODEL_API_KEY (Meta Model API); everything else is optional
./scripts/fetch_data.sh       # optional: real KW51 data + dacl10k sample images into demo-media/
./dev.sh                      # backend :8000 + frontend :5173
open http://localhost:5173
```

Check the Meta API key with `curl localhost:8000/api/meta/ping`. Without any keys, the map, the twin, both data
sources (simulated corridor and KW51 replay), alerts, the drone planner's geometry and the demo walkthrough all work.

## Configuration

| Variable | Purpose |
|---|---|
| `MODEL_API_KEY` | Meta Model API key: SAM 3.1, Muse Spark, Wonder, Image, Voice |
| `GLIMMER_BASE_URL` / `_API_KEY` / `_MODEL` | Muse Glimmer endpoint (OpenAI-compatible) |
| `SPARK_OPEN_BASE_URL` / `_API_KEY` / `_MODEL` | Muse Spark Open endpoint (OpenAI-compatible) |
| `SAM3D_OBJECTS_URL`, `SAM3D_BODY_URL`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET` | SAM 3D endpoints deployed from `modal_workers/` |
| `APP_ACCESS_TOKEN`, `COOKIE_SECURE` | Access control (production) |
| `MAX_DAILY_USD` | Daily spend cap for paid model calls (default 5) |
| `DATA_DIR`, `SAMPLES_DIR`, `KW51_PATH`, `FRONTEND_DIST` | Storage and data locations |
| `TRIAGE_AUTO`, `SIM_TICK_HZ`, `SIM_AUTO_ANOMALY_S`, `KW51_HOURS_PER_S` | Behaviour tuning |

Modal Sandboxes (Spark Open check) use the local Modal login (`modal token new`).

## Production

```bash
docker build -t infratwin-live .
docker run -p 8000:8000 --env-file .env \
  -e APP_ACCESS_TOKEN=<long random token> -e MAX_DAILY_USD=10 \
  -v infratwin-data:/data infratwin-live
```

Everything is served on port 8000. Findings, notes, forecasts, lifted point clouds and the spend ledger live in
`/data`. Datasets are not baked into the image; mount them and point `KW51_PATH` / `SAMPLES_DIR` at them.

A sensor gateway pushes readings like this:

```bash
curl -X POST https://<host>/api/ingest -H "Authorization: Bearer $APP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{"readings": {"B07.P4.strain": 212.4, "B07.P4.accel": 13.1}}'
```

## API overview

| Area | Endpoints |
|---|---|
| Twin and telemetry | `GET /api/assets`, `WS /ws/telemetry`, `POST /api/ingest`, `POST /api/replay/{asset}`, `POST /api/demo/reset` |
| Inspection | `GET /api/inspect/vocabulary`, `POST /api/inspect/segment`, `POST /api/inspect/segment-video`, `POST /api/inspect/workzone`, `GET /api/samples` |
| Findings | `GET/POST /api/findings`, `DELETE /api/findings/{id}`, `POST /api/findings/{id}/verify`, `POST /api/findings/{id}/lift`, `GET/POST /api/findings/{id}/forecasts` |
| AI workflows | `POST /api/triage`, `POST /api/missions`, `POST /api/voice`, `GET /api/notes` |
| Operations | `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/status` |

Interactive docs: `http://localhost:8000/docs`.

## Project layout

```
backend/                 FastAPI · Python 3.12 · uv
  app/main.py              routes, WebSocket, auth/budget wiring, static UI in production
  app/simulator.py         reading stream (replay / ingest / synthetic), health roll-up, alerts
  app/kw51.py              real KW51 data: loading, temperature-compensated baseline, replay clock
  app/corridor.py          assets, members, sensors, obstacles (illustrative geometry)
  app/sam31.py             SAM 3.1 photo segmentation, defect→element attribution, measurement
  app/sam31_video.py       clip transcoding (PyAV) and SAM 3.1 video tracks
  app/metrology.py         host-scale measurement and plane-raycasting metrology
  app/triage.py            Cognitive Twin: context assembly, streamed Muse Spark assessment
  app/screening.py         Muse Glimmer first-pass screening
  app/uav_planner.py       view scoring, occlusion tests, collision-checked flight paths
  app/missions.py          Muse Wonder mission planning with function tools
  app/voice.py             Voice Transcribe + intent parsing, field notes
  app/forecast.py          time-travel previews (Muse Spark → Muse Image)
  app/verify.py            Spark Open independent re-measurement
  app/sandbox.py           Modal Sandbox runner (network-blocked)
  app/sam3d.py             SAM 3D client, lifted defects, work-zone geofencing
  app/findings.py          inspection findings store
  app/auth.py, budget.py   access control, daily spend guard
  app/meta_client.py       Meta Model API client; openweight.py for OpenAI-compatible hosts
frontend/                Vite · React 19 · TypeScript · Tailwind v4 · MapLibre · React Three Fiber
modal_workers/           SAM 3D Objects / Body GPU service for Modal
scripts/                 dataset download and sample selection
docs/ROADMAP.md          feature status and Meta API integration notes
```

## Tests

`cd backend && uv run pytest`: 49 tests covering SAM 3.1 stream parsing (against the documented sample output),
defect attribution, video tracks and billing minimums, measurement accuracy on synthetic geometry, KW51
temperature compensation vs. stiffness change, replay, ingest, triage streaming and cooldowns, Wonder's tool loop,
occlusion and path planning, voice end-to-end with the spec's example command, time-travel caching, the Spark Open
tool loop against a real decoded mask, SAM 3D endpoints and geofencing, auth, and the spend cap. Model-written code
in tests runs only in a test-local stand-in for the sandbox.

## Data and references

- **dacl10k**: Flotzinger, Rösch, Braml, *dacl10k: Benchmark for Semantic Bridge Damage
  Segmentation*, WACV 2024 ([arXiv 2309.00460](https://arxiv.org/abs/2309.00460)). Defect taxonomy and sample
  images. The mirror is labelled CC BY 4.0; the authors' supplement states CC BY-NC 4.0.
- **synth-dacl**: Flotzinger et al., *Does Synthetic Defect Data Enhance Segmentation Accuracy and Robustness for
  Real-World Bridge Inspections?* ([arXiv 2506.14255](https://arxiv.org/abs/2506.14255)).
- **KW51 monitoring data**: K. Maes, G. Lombaert, *Monitoring railway bridge KW51 before, during, and after
  retrofitting*, J. Bridge Eng. 26(3), 2021; data [Zenodo 3745914](https://zenodo.org/record/3745914),
  CC BY-NC-SA 4.0.
- **ASIP-Planner**: H. Jin et al., *Adaptive Planning for UAV Surface Inspection in Partially Known Indoor
  Environments*, IROS 2026 ([arXiv 2605.11119](https://arxiv.org/abs/2605.11119)). It informs the
  occlusion-adaptive view planning.
- **Gaussian-splatting damage twins**: S. Wang et al., *Three-dimensional Damage Visualization of Civil
  Structures via Gaussian Splatting-enabled Digital Twins* ([arXiv 2602.16713](https://arxiv.org/abs/2602.16713)).
  Planned work, see below.

Datasets are downloaded locally by `scripts/fetch_data.sh` into `demo-media/` and are not redistributed.

## Not done yet

- **Multi-view Scan-to-BIM** (grouping detections from many views into 3D members) and **Gaussian-splatting
  damage refinement** both need multi-view 3D reconstructions from SAM 3D and a walk-around capture of a real structure.
- **SAM 3D service** is written to Meta's setup docs but has not yet been built or run on a GPU.
- **KW51 geometry** is illustrative; KU Leuven's published finite-element model ([Zenodo 17366772](https://zenodo.org/records/17366772)) could replace it.
- **Drone planner** follows ASIP-Planner's idea (online view-angle adaptation around occlusions); aligning it
  step-by-step with the paper's published algorithm is planned.
- **CI workflow** (tests, UI build, container build) is ready locally; pushing it needs the GitHub `workflow` scope.
