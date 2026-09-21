"""Test harness: a real Postgres, migrations once, every test rolled back.

Point `TEST_DATABASE_URL` at any Postgres; the database named in it is created if missing.
Tests run inside a transaction on a single connection that is rolled back afterwards, so they
see each other's schema but never each other's rows.
"""

import os
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine
from sqlalchemy.sql import text

from lattice.api.deps import get_session
from lattice.config import Settings
from lattice.db.migrate import upgrade
from lattice.main import create_app

DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://lattice:lattice@localhost:5432/lattice_test"


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
        database_url=migrated_database,
        dev_header_auth=True,
        cognee_root=tmp_path / "cognee",
        uploads_dir=tmp_path / "uploads",
    )


@pytest.fixture
def app(settings: Settings, session: AsyncSession) -> Iterator[FastAPI]:
    app = create_app(settings)

    async def override() -> AsyncIterator[AsyncSession]:
        """Same commit-on-success contract as the real dependency, inside the test's savepoint."""
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        await session.commit()

    app.dependency_overrides[get_session] = override
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """No lifespan: these tests exercise Postgres records, not Cognee start-up."""
    return TestClient(app)
