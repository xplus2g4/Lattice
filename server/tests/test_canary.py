"""The canary from ADR 0002: a student's private Note must never reach another principal.

Runs the real thing end to end, because the property is about Cognee's behaviour and a mock
would only assert our beliefs about it. Both enforcement layers are covered:

1. Cognee's dataset permissions, asserted twice: Bob's `/ask` never carries Alice's Note,
   and Bob naming her dataset directly is refused.
2. The API-level citation check, which runs inside every `/ask` here and is unit-tested
   exhaustively in `test_isolation.py`.

Cost: two cognifies of a few hundred tokens, roughly $0.02 and under a minute on DeepSeek
V4 Flash. Marked `canary`, so a plain `uv run pytest` skips it when no key is configured.
"""

import asyncio
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from cognee.modules.users.exceptions import PermissionDeniedError
from fastapi.testclient import TestClient

from lattice.config import Settings
from lattice.engine import Engine
from lattice.main import create_app

COURSE = "cs101"
ALICE = "alice@example.com"
BOB = "bob@example.com"

# Nonsense on purpose: it cannot plausibly be reconstructed from the course material or
# invented by the model, so finding it in Bob's response can only mean a leak.
PASSPHRASE = "tungsten-marmalade-seventeen"

MATERIAL = b"# Week 3\n\nHash tables store key-value pairs and resolve collisions by chaining.\n"
NOTE = f"My mnemonic for week 3 hash tables is {PASSPHRASE}, which I must not forget."

QUESTION = "what should I remember about hash tables in week 3?"


@pytest.fixture
def workspace() -> Iterator[Path]:
    """A deliberately short temporary root, not pytest's `tmp_path`.

    Cognee nests about 190 characters below the root on its own
    (`system/databases/<uuid>/<uuid>.lance.db/<Table>.lance/_transactions/<uuid>.txn`) and
    `tmp_path` spends about 90 more on `pytest-of-<user>/pytest-N/<test name>`. Together
    they cross Windows' 260-character MAX_PATH, and LanceDB fails the cognify with
    "failed to persist temp file" rather than anything that points at path length.
    """
    root = Path(tempfile.mkdtemp(prefix="lat"))
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def settings_for(workspace: Path) -> Settings:
    # Single-letter names for the same reason the root is short.
    return Settings(
        cognee_root=workspace / "c",
        uploads_dir=workspace / "u",
        dev_header_auth=True,
    )


def as_user(email: str) -> dict[str, str]:
    return {"X-User": email}


def statuses(client: TestClient, path: str, email: str) -> list[str]:
    response = client.get(f"/courses/{COURSE}/{path}", headers=as_user(email))
    response.raise_for_status()
    return [item["status"] for item in response.json()]


@pytest.mark.canary
def test_private_notes_never_leak(workspace: Path) -> None:
    config = settings_for(workspace)

    with TestClient(create_app(config)) as client:
        # Course material in the global tier, and Alice's Note in her private tier. Cognify
        # runs in a BackgroundTask, which TestClient completes before returning.
        upload = client.post(
            f"/courses/{COURSE}/materials",
            files={"file": ("week3.md", MATERIAL, "text/markdown")},
            headers=as_user(ALICE),
        )
        assert upload.status_code == 202, upload.text
        saved = client.put(
            f"/courses/{COURSE}/notes/n1",
            json={"body_md": NOTE},
            headers=as_user(ALICE),
        )
        assert saved.status_code == 202, saved.text

        # Without this the test passes vacuously: a failed cognify leaves both tiers empty,
        # and then nobody can see Alice's Note because nobody can see anything.
        assert statuses(client, "materials", ALICE) == ["ready"]
        assert statuses(client, "notes", ALICE) == ["ready"]

        alice_answer = client.post(
            f"/courses/{COURSE}/ask",
            json={"question": QUESTION, "query_type": "CHUNKS"},
            headers=as_user(ALICE),
        )
        assert alice_answer.status_code == 200, alice_answer.text
        assert PASSPHRASE in alice_answer.text, "Alice cannot retrieve her own Note"

        bob_answer = client.post(
            f"/courses/{COURSE}/ask",
            json={"question": QUESTION, "query_type": "CHUNKS"},
            headers=as_user(BOB),
        )
        assert bob_answer.status_code == 200, bob_answer.text

        # The whole response body, not just the answer text: a leak through a citation,
        # a dataset name or a tier label counts just the same.
        assert PASSPHRASE not in bob_answer.text
        tiers = {result["tier"] for result in bob_answer.json()["turn"]["results"]}
        assert "notes" not in tiers, f"Bob was served a notes tier: {tiers}"

        # Bob still gets a real answer, so the absence above is isolation and not silence.
        assert tiers == {"course"}, f"expected only the course tier, got {tiers}"

    asyncio.run(_bob_is_refused_alices_dataset(config))


async def _bob_is_refused_alices_dataset(config: Settings) -> None:
    """Layer 1 head-on: naming Alice's private dataset is refused, not filtered.

    Runs on a second Engine over the same Cognee root, which resolves the same principals
    and dataset ids, once the TestClient's event loop has closed.
    """
    engine = Engine(config)
    await engine.start()
    alice = await engine.principal(ALICE)
    bob = await engine.principal(BOB)
    _, alices_notes = await engine.enrol(COURSE, alice)

    with pytest.raises(PermissionDeniedError):
        await engine.search(bob, {alices_notes.id: "notes"}, QUESTION, "CHUNKS", "canary")
