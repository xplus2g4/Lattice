import os
from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
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
    mcp_api_url: str = "http://127.0.0.1:8000"

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

    # How often the course summaries, one vector per course, are recomputed, and how many
    # of the nearest courses `/ask` also searches (0 turns the related lane off).
    course_summary_refresh_s: int = 3600
    related_courses_k: int = 3

    # Telemetry. `/metrics` is 404 until a token is set; then it wants `Authorization: Bearer`.
    log_level: str = "INFO"
    metrics_token: str | None = None

    # Spend. Prices per million tokens, keyed by litellm model name without the provider
    # prefix, e.g. `{"gpt-4o-mini": {"input": 0.15, "output": 0.60}}`. Never litellm's table.
    # The Ceiling is USD per UTC day; unset means no 429 and no 80 % alert.
    spend_prices_usd_per_1m: dict[str, dict[str, float]] = {}
    spend_ceiling_usd: float | None = None

    # Alerts go to one Telegram chat; unset, the watchdog logs instead of sending.
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    deployment_name: str = "lattice"
    watchdog_tick_s: int = 60
    alert_ingest_stuck_s: int = 600
    alert_loop_stalled_s: int = 300

    def price_for(self, model: str) -> dict[str, float] | None:
        """The price row for a litellm model name, with or without its `provider/` prefix."""
        return self.spend_prices_usd_per_1m.get(model.rpartition("/")[2])

    @model_validator(mode="after")
    def _ceiling_needs_prices(self) -> Settings:
        """A Ceiling is enforced from the ledger, so every model that writes to it must be
        priced; otherwise the day's total silently under-counts. Cognee reads `LLM_MODEL` and
        `EMBEDDING_MODEL` from the environment, so look there rather than mirroring them."""
        if self.spend_ceiling_usd is None:
            return self
        for variable in ("LLM_MODEL", "EMBEDDING_MODEL"):
            model = os.environ.get(variable)
            if not model or self.price_for(model) is None:
                raise ValueError(
                    f"SPEND_CEILING_USD is set but {variable}={model or '<unset>'} has no "
                    "entry in SPEND_PRICES_USD_PER_1M"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
