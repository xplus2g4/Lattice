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

    # Honour the `X-User` header as the caller's identity and enable `/auth/dev`.
    # Dev only; never set this in a deploy — it is an impersonation backdoor.
    dev_header_auth: bool = False

    # The Web OAuth client id the sign-in button is configured with.
    # Empty disables `/auth/google` (it answers 501).
    google_client_id: str = ""
    # When set, Google sign-in only accepts Workspace accounts on this domain (`hd` claim).
    google_hosted_domain: str = ""

    # Signs the session token (a JWT). Unset means an ephemeral per-process key: dev
    # sessions reset on restart instead of trusting a secret committed to the repo.
    session_secret: str | None = None
    session_ttl_hours: int = 24 * 7

    # Emails promoted to the admin role at first sight.
    admin_emails: list[str] = []

    # Principal that owns every course's global dataset and runs material ingest.
    instructor_email: str = "instructor@lattice.example"

    # Where Cognee keeps its embedded databases and where uploaded files land.
    cognee_root: Path = Path(".cognee")
    uploads_dir: Path = Path("data/uploads")
    max_upload_mb: int = 25


@lru_cache
def get_settings() -> Settings:
    return Settings()
