from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration, read from the environment (and `.env` in dev).

    Shared by the API and the Worker; both run from the same image with the same env.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
