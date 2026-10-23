from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PADEL_", extra="ignore")

    database_url: str = "postgresql://padel:padel@localhost:5432/padel_lobby"
    jwt_secret: str = "dev-secret-troque-em-producao-0123456789"
    jwt_ttl_hours: int = 24 * 7
    timezone: str = "America/Sao_Paulo"
    # Segredo do webhook Pix (PSP → API). Em dev, o endpoint de simulação fica liberado.
    pix_webhook_secret: str = "dev-webhook-secret"
    dev_mode: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]
    jobs_interval_seconds: int = 30

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


@lru_cache
def get_settings() -> Settings:
    return Settings()
