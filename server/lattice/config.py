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

    # Honour the `X-User` header as the caller's identity. Dev only; Bearer replaces it.
    dev_header_auth: bool = False
    # A fixed invite token that always redeems (as student). Only honoured while
    # dev_header_auth is on, so it cannot leak into a deployment.
    dev_invite_code: str = ""
    mcp_enabled: bool = False

    # HS256 key for the tokens the web app mints after Google sign-in. Shared with the
    # web app; empty disables Bearer verification so tests and MCP dev stay header-only.
    token_secret: str = ""

    # Principal that owns every course's global dataset and runs material ingest.
    instructor_email: str = "instructor@lattice.example"
    # Extra emails that bootstrap as instructor on sign-in, alongside instructor_email.
    # For co-teachers/dev accounts you want privileged without going through an invite.
    instructor_emails: list[str] = []

    # Where Cognee keeps its embedded databases and where uploaded files land.
    cognee_root: Path = Path(".cognee")
    uploads_dir: Path = Path("data/uploads")
    max_upload_mb: int = 25


@lru_cache
def get_settings() -> Settings:
    return Settings()
