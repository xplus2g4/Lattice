from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration, read from the environment (and `.env` in dev).

    Shared by the API and the Worker; both run from the same image with the same env.
    Cognee reads its own `LLM_*`, `EMBEDDING_*` and storage variables from the same `.env`;
    those are deliberately not mirrored here.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cors_origins: list[str] = ["http://localhost:3000"]

    # Lattice's own Postgres: application records only. Cognee keeps its embedded stores.
    database_url: str = "postgresql+asyncpg://lattice:lattice@localhost:5432/lattice"
    database_pool_size: int = 5
    # Run `alembic upgrade head` on start-up. Convenient in dev; deploys run it explicitly.
    database_auto_migrate: bool = False

    # Honour the `X-User` header as the caller's identity. Dev only; there is no OAuth yet.
    dev_header_auth: bool = False

    # Principal that owns every course's global dataset and runs material ingest.
    instructor_email: str = "instructor@lattice.example"

    # Where Cognee keeps its embedded databases and where uploaded files land.
    cognee_root: Path = Path(".cognee")
    uploads_dir: Path = Path("data/uploads")
    max_upload_mb: int = 25

    # Worker: how often it looks for work, how long a lock outlives a dead worker, and how
    # many attempts a job gets before it stays failed.
    worker_poll_seconds: float = 1.0
    worker_lock_ttl_seconds: float = 300.0
    worker_max_attempts: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
