# Feature roadmap

Build order: each step ships a working, demoable increment on top of the foundation.

| # | Feature | Meta model / tool | Status |
|---|---------|-------------------|--------|
| 0 | Foundation: GIS corridor map, placeholder BIM twin, live SHM telemetry + health roll-up, alerts | — | ✅ |
| 1 | SAM 3.1 dual-vocabulary segmentation of inspection frames: structural elements + dacl10k defects, mask overlays, defect → host-element attribution | `sam-3.1` | ✅ |
| 2 | Pin findings to twin components (geo-anchored defect markers) + SAM 3.1 video tracking | `sam-3.1` | ⬜ |
| 3 | SAM 3D Objects defect lifting + SAM 3D Body worker geofence on Modal | SAM 3D (open weights) | ⬜ |
| 4 | Union-Find Scan-to-BIM component clustering (replaces placeholder geometry) | — | ⬜ |
| 5 | Hierarchical refinement: coarse structure + hi-res defect patch, compute-savings badge | — | ⬜ |
| 6 | Normal-gradient raycasting metrology (area, perimeter, crack width, inclination) | Muse Spark Open | ⬜ |
| 7 | Anomaly triage + Cognitive Twin reasoning panel (streamed) | `muse-spark-1.3` / Glimmer | ⬜ |
| 8 | Occlusion-adaptive UAV re-planner (Algorithm 2), 3D flight path on twin + map | `muse-wonder-1.0` | ⬜ |
| 9 | Voice field commands → tool calls / geo-pinned notes | `muse-voice-transcribe-1.0` | ⬜ |
| 10 | Time-travel deterioration + repair preview | `muse-image-1.0` | ⬜ |
| 11 | Demo script polish, README, 2-min video | — | ⬜ |

## Integration notes (from dev.meta.ai/docs)

- Base `https://api.meta.ai/v1`, `Authorization: Bearer $MODEL_API_KEY`; OpenAI-compatible Responses API.
- **SAM 3.1**: `POST /responses`, `model: sam-3.1`, one short noun-phrase concept per request
  (`input_text`) + one `input_image` (URL/data URL) or `input_video` (`file_id` from `POST /files`, purpose `user_data`).
  Output is a token stream, one line per frame:
  `<Nf>id<|box;x1;y1;x2;y2;w;h[;c]|><|mask;...;data=H,W,<enc>base85|>,...` — `~` lossless, `!` one_bit.
  Set `metadata.include_confidence: "true"`. Multi-concept prompts are unreliable → fan out one request per class.
  Parse with Meta's official `meta-sam-parser` (`parse_responses_stream` + `image_segmentation_format`); masks are
  box-local rasters. We request `one_bit` masks: the lossless decoder is a pure-Python range coder and slow on large masks.
- **Muse Image**: `POST /images/generations` and `/images/edits` (`images: [{image_url}]`), $0.01/image.
- **Voice**: `POST /asr/transcribe` multipart (`request` JSON + `audio` WAV, ≤10 min). Browser audio must be converted to WAV.
