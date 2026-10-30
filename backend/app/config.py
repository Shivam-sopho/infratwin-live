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

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()
