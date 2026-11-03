#!/usr/bin/env bash
# Run InfraTwin-Live locally with one command:  ./start.sh
# Uses Docker if it is installed and running (nothing else needed); otherwise Node 20+ and uv.
set -euo pipefail
cd "$(dirname "$0")"
[ -d "$HOME/.docker/bin" ] && export PATH="$HOME/.docker/bin:$PATH"   # Docker Desktop on macOS

# 1. Meta Model API key (stored only in the local, git-ignored .env)
[ -f .env ] || cp .env.example .env
if ! grep -qE '^MODEL_API_KEY=.+' .env; then
  echo "InfraTwin-Live uses Meta's models (SAM 3.1, Muse Spark, Wonder, Image, Voice)."
  read -r -p "Paste your Meta Model API key from dev.meta.ai (or press Enter to explore without AI): " KEY
  if [ -n "${KEY:-}" ]; then
    grep -v '^MODEL_API_KEY=' .env > .env.tmp || true
    printf 'MODEL_API_KEY=%s\n' "$KEY" | cat - .env.tmp > .env && rm -f .env.tmp
    chmod 600 .env
  fi
fi

open_when_ready() {
  until curl -sf "http://localhost:$1/api/health" >/dev/null 2>&1; do sleep 2; done
  echo; echo "InfraTwin-Live is running at http://localhost:$1  (click ▶ Play demo)"; echo
  (command -v open >/dev/null && open "http://localhost:$1") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$1") || true
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Starting with Docker. The first build downloads the real datasets and takes a few minutes."
  open_when_ready 8000 &
  exec docker compose up --build
fi

echo "Docker not found or not running: starting with Node + uv instead."
command -v node >/dev/null || { echo "Install Node 20+ (https://nodejs.org) or Docker Desktop, then re-run ./start.sh"; exit 1; }
command -v uv >/dev/null || { echo "Install uv (https://docs.astral.sh/uv/) or Docker Desktop, then re-run ./start.sh"; exit 1; }
[ -f demo-media/kw51/trackedmodes/trackedmodes/trackedmodes.mat ] || ./scripts/fetch_data.sh --runtime
open_when_ready 5173 &
exec ./dev.sh
