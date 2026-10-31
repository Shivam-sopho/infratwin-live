# Feature roadmap

Build order: each step ships a working, demoable increment on top of the foundation.

| # | Feature | Meta model / tool | Status |
|---|---------|-------------------|--------|
| 0 | Foundation: GIS corridor map, placeholder BIM twin, live SHM telemetry + health roll-up, alerts | — | ✅ |
| 1 | SAM 3.1 dual-vocabulary segmentation of inspection frames: structural elements + dacl10k defects, mask overlays, defect → host-element attribution | `sam-3.1` | ✅ |
| 2 | Pin findings to twin components (defect patches on twin, counts on map, findings log) + SAM 3.1 video tracking | `sam-3.1` | ✅ |
| 3 | SAM 3D Objects defect lifting + SAM 3D Body worker geofence on Modal | SAM 3D (open weights) | ⬜ |
| 4 | Union-Find Scan-to-BIM component clustering (replaces placeholder geometry) | — | ⬜ |
| 5 | Hierarchical refinement: coarse structure + hi-res defect patch, compute-savings badge | — | ⬜ |
| 6 | Defect metrology: host-element scale (area, perimeter, crack length/width) ✅; normal-gradient plane raycasting (true area + inclination) implemented & tested, awaits SAM 3D depth; Muse Spark Open + Modal Sandbox execution ⬜ | Muse Spark Open | 🟡 |
| 7 | Cognitive Twin: Muse Spark triage of critical alerts with streamed reasoning + structured assessment (Glimmer first-pass pending hosting) | `muse-spark-1.3` / Glimmer | ✅ Spark · ⬜ Glimmer |
| 8 | Occlusion-adaptive UAV re-planner: Algorithm 2 view scoring + collision-checked paths as tools for Muse Wonder; 3D flight on twin + map | `muse-wonder-1.0` | ✅ |
| 9 | Voice field commands: push-to-talk → Voice Transcribe (twin vocabulary as keywords) → Muse Spark intents → notes, measurements, triage, drone re-scan, navigation | `muse-voice-transcribe-1.0` + `muse-spark-1.3` | ✅ |
| 10 | Time-travel previews: Muse Spark reasons (narrative + edit prompt) → Muse Image edits the defect photo for +6 months / +2 years / repaired; cached, labelled illustrative | `muse-spark-1.3` + `muse-image-1.0` | ✅ |
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
- **SAM 3.1 video**: clip uploaded via `POST /files` (purpose `user_data`), referenced as `input_video.file_id`.
  We re-encode to 5 fps / ≤20 s / ≤960 px H.264 with PyAV first (bills per frame, min 50 frames per request),
  baking in phone rotation metadata. Parse with `video_segmentation_format`; object ids are stable → tracks.
- **Muse Spark (Responses API)**: `reasoning: {effort, summary: "concise"}` streams
  `response.reasoning_summary_text.delta` (raw chain of thought is never exposed); structured output via
  `text.format = {type: "json_schema", name, schema, strict: true}` (strict: root object, additionalProperties false,
  every property required).
- **Tool calling (Responses API)**: flat `{type: "function", name, description, parameters, strict}` tools; the model
  emits `function_call` items (`call_id`, `arguments`) on `response.output_item.done`; results go back as
  `function_call_output` items with `previous_response_id` (instructions must be resent each turn).
  `tool_choice` only supports `"auto"`, so the app handles both tool calls and final answers.
- **Muse Image**: `POST /images/generations` and `/images/edits` (raw JSON: `images: [{image_url}]`, `prompt`,
  `response_format: "b64_json"`, `output_format`), $0.01/image; response `data[0].b64_json`.
- **Voice**: `POST /asr/transcribe` multipart (`request` JSON + `audio` WAV, ≤10 min); WAV must be mono 16-bit PCM at
  16 or 24 kHz (browser: MediaRecorder → decodeAudioData → OfflineAudioContext resample → PCM16 encode). Response
  `{sessionId, transcript, audioDurationMs, turns}`; `keywords` biases recognition toward twin vocabulary.
