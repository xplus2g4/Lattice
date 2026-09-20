"""Shared pytest configuration.

The `canary` marker guards tests that spend real LLM calls. They are skipped unless an LLM
key is configured, so `uv run pytest` stays free and offline for a contributor without one,
and CI can gate them on a secret instead of running them on every push.
"""

import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

os.environ.setdefault("COGNEE_LOG_FILE", "false")
os.environ.setdefault("TELEMETRY_DISABLED", "1")

SERVER_ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER = "sk-..."


@pytest.fixture
def workspace(monkeypatch) -> Iterator[Path]:
    """A deliberately short temporary root, not pytest's `tmp_path`.

    Cognee nests about 190 characters below the root on its own
    (`system/databases/<uuid>/<uuid>.lance.db/<Table>.lance/_transactions/<uuid>.txn`) and
    `tmp_path` spends about 90 more on `pytest-of-<user>/pytest-N/<test name>`. Together
    they cross Windows' 260-character MAX_PATH, and LanceDB fails the cognify with
    "failed to persist temp file" rather than anything that points at path length.
    """
    from cognee.infrastructure.databases.cache.config import get_cache_config

    root = Path(tempfile.mkdtemp(prefix="lat"))
    monkeypatch.setenv("CACHE_BACKEND", "sqlite")
    monkeypatch.setenv("CACHE_DB_URL", f"sqlite+aiosqlite:///{root.as_posix()}/s.db")
    get_cache_config.cache_clear()
    try:
        yield root
    finally:
        get_cache_config.cache_clear()
        shutil.rmtree(root, ignore_errors=True)


def llm_key_configured() -> bool:
    """Cognee takes `LLM_API_KEY` from the environment or `server/.env`; check both."""
    if os.environ.get("LLM_API_KEY", "").strip() not in ("", PLACEHOLDER):
        return True
    env_file = SERVER_ROOT / ".env"
    if not env_file.exists():
        return False
    for line in env_file.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "LLM_API_KEY":
            return value.strip().strip("\"'") not in ("", PLACEHOLDER)
    return False


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "canary: spends real LLM calls; needs LLM_API_KEY (see tests/test_canary.py)"
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if llm_key_configured():
        return
    skip = pytest.mark.skip(reason="no LLM_API_KEY: the canary needs a real cognify")
    for item in items:
        if "canary" in item.keywords:
            item.add_marker(skip)
