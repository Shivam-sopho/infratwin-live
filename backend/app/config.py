from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # Meta Model API (https://dev.meta.ai/docs) — OpenAI-compatible, Bearer auth.
    model_api_key: str = ""
    meta_api_base: str = "https://api.meta.ai/v1"

    # Telemetry simulator
    sim_tick_hz: float = 2.0
    # Seconds after startup to auto-inject the scripted Pier 4 anomaly (0 = off).
    sim_auto_anomaly_s: float = 0.0

    # Open-weight Muse models, served by any OpenAI-compatible endpoint (vLLM on Modal, OpenRouter,
    # Together, Fireworks...). Each is optional; features degrade gracefully when unset.
    glimmer_base_url: str = ""
    glimmer_api_key: str = ""
    glimmer_model: str = ""
    spark_open_base_url: str = ""
    spark_open_api_key: str = ""
    spark_open_model: str = ""

    # SAM 3D Objects / Body endpoints deployed from modal_workers/sam3d_service.py (proxy-auth protected).
    sam3d_objects_url: str = ""
    sam3d_body_url: str = ""
    modal_proxy_key: str = ""
    modal_proxy_secret: str = ""

    # Cognitive Twin: auto-triage critical alerts with Muse Spark.
    triage_auto: bool = True

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Storage (findings, notes, forecasts, lifts) and optional local sample images.
    data_dir: Path = BACKEND_DIR / "data"
    samples_dir: Path = BACKEND_DIR.parent / "demo-media" / "dacl10k"
    # Built UI to serve from the API origin (production). Unset/missing in dev, where Vite serves it.
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"

    # Access control: when set, every API call and the telemetry socket require this token
    # (browser: login sets an HttpOnly cookie; machines: Authorization: Bearer <token>).
    app_access_token: str = ""
    cookie_secure: bool = False  # set true behind HTTPS

    # Spend guard for paid model calls (estimated USD per UTC day).
    max_daily_usd: float = 5.0


settings = Settings()
