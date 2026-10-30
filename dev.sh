#!/usr/bin/env bash
# Run backend (FastAPI :8000) and frontend (Vite :5173) together. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

(cd backend && uv sync -q && uv run uvicorn app.main:app --reload --port 8000) &
(cd frontend && { [ -d node_modules ] || npm install; } && npx vite --port 5173) &

trap 'kill 0' EXIT INT TERM
wait
