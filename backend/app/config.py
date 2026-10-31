from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Cognitive Twin: auto-triage critical alerts with Muse Spark.
    triage_auto: bool = True

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()
