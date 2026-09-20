"""Shared pytest configuration.

The `canary` marker guards tests that spend real LLM calls. They are skipped unless an LLM
key is configured, so `uv run pytest` stays free and offline for a contributor without one,
and CI can gate them on a secret instead of running them on every push.
"""

import os
from pathlib import Path

import pytest

os.environ.setdefault("COGNEE_LOG_FILE", "false")
os.environ.setdefault("TELEMETRY_DISABLED", "1")

SERVER_ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER = "sk-..."


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
