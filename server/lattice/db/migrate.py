"""Running Alembic from Python, so start-up and tests use the same migrations as the CLI."""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

CONFIG_PATH = Path(__file__).resolve().parents[2] / "alembic.ini"


def alembic_config(database_url: str) -> Config:
    config = Config(str(CONFIG_PATH))
    config.set_main_option("script_location", str(CONFIG_PATH.parent / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def upgrade(database_url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(database_url), revision)


def downgrade(database_url: str, revision: str = "base") -> None:
    command.downgrade(alembic_config(database_url), revision)


async def upgrade_async(database_url: str, revision: str = "head") -> None:
    """Alembic is synchronous; keep its event loop off the caller's."""
    await asyncio.to_thread(upgrade, database_url, revision)
