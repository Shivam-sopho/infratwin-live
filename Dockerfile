# One container: FastAPI serves the API, the telemetry socket and the built UI.
#   docker build -t infratwin-live .
#   docker run -p 8000:8000 -e MODEL_API_KEY=... -v infratwin-data:/data infratwin-live
# Works as-is on container hosts that set $PORT (e.g. Hugging Face Spaces uses 7860).

FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Real datasets, downloaded from their original sources at build time (not redistributed in the repo):
# KW51 tracked modes (KU Leuven, Zenodo 3745914, CC BY-NC-SA 4.0) and dacl10k inspection photos.
FROM python:3.12-slim AS data
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts ./scripts
RUN bash scripts/fetch_data.sh --runtime

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY --from=ui /ui/dist /app/frontend/dist
COPY --from=data /src/demo-media /app/demo-media

ENV DATA_DIR=/data FRONTEND_DIST=/app/frontend/dist \
    SAMPLES_DIR=/app/demo-media/dacl10k \
    KW51_PATH=/app/demo-media/kw51/trackedmodes/trackedmodes/trackedmodes.mat \
    PORT=8000
RUN useradd --create-home --uid 1000 app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/health')"
CMD ["sh", "-c", "exec /app/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
