# One container: the FastAPI backend serves the API, the telemetry socket and the built UI.
#   docker build -t infratwin-live .
#   docker run -p 8000:8000 --env-file .env -e APP_ACCESS_TOKEN=... -v infratwin-data:/data infratwin-live

FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY --from=ui /ui/dist /app/frontend/dist

ENV DATA_DIR=/data FRONTEND_DIST=/app/frontend/dist SAMPLES_DIR=/data/samples COOKIE_SECURE=true
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app /data
USER app
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["/app/backend/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
