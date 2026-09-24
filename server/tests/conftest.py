"""Shared pytest configuration.

The `canary` marker guards tests that spend real LLM calls. They are skipped unless an LLM
key is configured, so `uv run pytest` stays free and offline for a contributor without one,
and CI can gate them on a secret instead of running them on every push.

Test harness: a real Postgres, migrations once, every test rolled back.

Point `TEST_DATABASE_URL` at any Postgres; the database named in it is created if missing.
Tests run inside a transaction on a single connection that is rolled back afterwards, so they
see each other's schema but never each other's rows.
"""

import os
import shutil
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.sql import text

from lattice.config import Settings, get_settings
from lattice.db.migrate import upgrade
from lattice.retrieval import TierResult

os.environ.setdefault("COGNEE_LOG_FILE", "false")
os.environ.setdefault("TELEMETRY_DISABLED", "1")
SERVER_ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER = "sk-..."
DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://lattice:lattice@localhost:5432/lattice_test"


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


def key_configured(name: str) -> bool:
    """Cognee takes provider keys from the environment or `server/.env`; check both."""
    if os.environ.get(name, "").strip() not in ("", PLACEHOLDER):
        return True
    env_file = SERVER_ROOT / ".env"
    if not env_file.exists():
        return False
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == name:
            return value.strip().strip("\"'") not in ("", PLACEHOLDER)
    return False


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "canary: spends real LLM and embedding calls; needs LLM_API_KEY and EMBEDDING_API_KEY "
        "(see tests/test_canary.py)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    missing = [name for name in ("LLM_API_KEY", "EMBEDDING_API_KEY") if not key_configured(name)]
    if not missing:
        return
    skip = pytest.mark.skip(reason=f"no {', '.join(missing)}: the canary needs a real cognify")
    for item in items:
        if "canary" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


@pytest.fixture(scope="session")
def migrated_database(database_url: str) -> str:
    """Create the test database if it is missing, then bring it to head."""
    import asyncio

    asyncio.run(_create_database_if_missing(database_url))
    upgrade(database_url)
    return database_url


async def _create_database_if_missing(database_url: str) -> None:
    name = database_url.rsplit("/", 1)[-1]
    maintenance = create_async_engine(
        database_url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT"
    )
    try:
        async with maintenance.connect() as connection:
            exists = await connection.scalar(
                text("select 1 from pg_database where datname = :name"), {"name": name}
            )
            if not exists:
                await connection.execute(text(f'create database "{name}"'))
    finally:
        await maintenance.dispose()


@pytest_asyncio.fixture
async def connection(migrated_database: str) -> AsyncIterator[AsyncConnection]:
    engine = create_async_engine(migrated_database)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest_asyncio.fixture
async def session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(
        connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    ) as session:
        yield session


@pytest.fixture
def settings(tmp_path, migrated_database: str) -> Settings:
    return Settings(
        _env_file=None,
        database_url=migrated_database,
        dev_header_auth=True,
        mcp_enabled=False,
        database_auto_migrate=False,
        cognee_root=tmp_path / "cognee",
        uploads_dir=tmp_path / "uploads",
    )


class FakePrincipal:
    def __init__(self, email: str) -> None:
        self.email = email
        self.id = uuid5(NAMESPACE_URL, f"principal:{email}")


class FakeDataset:
    def __init__(self, name: str) -> None:
        self.name = name
        self.id = uuid5(NAMESPACE_URL, f"dataset:{name}")


class FakeEngine:
    """Stands in for the Cognee seam: records the calls, touches no embedded store."""

    def __init__(self) -> None:
        self.enrolled: list[tuple[str, str]] = []
        self.cognified: list[str] = []
        self.cleared: list[tuple[UUID, str]] = []
        self.searched: list[dict[UUID, str]] = []
        self.results: list[TierResult] = []
        self.fail_with: Exception | None = None

    async def start(self) -> None:
        pass

    async def principal(self, email: str) -> FakePrincipal:
        return FakePrincipal(email)

    async def instructor(self) -> FakePrincipal:
        return FakePrincipal("instructor@lattice.example")

    async def enrol(self, course: str, user: FakePrincipal) -> tuple[FakeDataset, FakeDataset]:
        self.enrolled.append((course, user.email))
        return FakeDataset(f"{course}-global"), FakeDataset(f"{course}-user-{user.id}")

    async def global_dataset(self, course: str) -> FakeDataset:
        return FakeDataset(f"{course}-global")

    async def replace(
        self, dataset: FakeDataset, owner: FakePrincipal, path, chunk_size: int | None = None
    ) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.cognified.append(str(path))

    async def clear(self, dataset: FakeDataset, owner: FakePrincipal, filename: str) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.cleared.append((dataset.id, filename))

    async def search(
        self,
        user: FakePrincipal,
        datasets: dict[UUID, str],
        question: str,
        query_type: str,
        session_id: str,
    ) -> list[TierResult]:
        if self.fail_with is not None:
            raise self.fail_with
        self.searched.append(datasets)
        tiers = set(datasets.values())
        return [result for result in self.results if result.tier in tiers]


class RecordingIngest:
    """Captures what the request queued, instead of cognifying in the background."""

    def __init__(self) -> None:
        self.queued: list[UUID] = []
        self.notes: list[UUID] = []

    async def material(self, material_id: UUID) -> None:
        self.queued.append(material_id)

    async def note(self, note_id: UUID) -> None:
        self.notes.append(note_id)

    async def recover_notes(self) -> None:
        pass

    async def cognify_pending(self) -> bool:
        return False


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def ingest() -> RecordingIngest:
    return RecordingIngest()


@pytest.fixture
def sessionmaker(connection: AsyncConnection) -> async_sessionmaker:
    """Sessions for code that opens its own, still inside the test's rolled-back transaction."""
    return async_sessionmaker(
        connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


@pytest.fixture
def app(
    settings: Settings,
    session: AsyncSession,
    engine: FakeEngine,
    ingest: RecordingIngest,
    sessionmaker: async_sessionmaker,
) -> Iterator[FastAPI]:
    from lattice.api.deps import get_engine, get_ingest, get_session
    from lattice.main import create_app

    app = create_app(settings)
    app.state.engine = engine
    app.state.ingest = ingest
    app.state.database.sessionmaker = sessionmaker

    async def override() -> AsyncIterator[AsyncSession]:
        """Same commit-on-success contract as the real dependency, inside the test's savepoint."""
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        await session.commit()

    app.dependency_overrides[get_session] = override
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_ingest] = lambda: ingest
    app.dependency_overrides[get_settings] = lambda: settings
    yield app
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """In-process and in the test's own event loop, so it shares the rolled-back session.

    No lifespan either: these tests exercise Postgres records, not Cognee start-up.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def student(client: AsyncClient) -> AsyncClient:
    """A client that always identifies as the same student."""
    client.headers["X-User"] = "ada@example.com"
    return client
