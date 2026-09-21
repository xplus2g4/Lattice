"""The database foundation itself: harness, migrations, and model/schema agreement."""

import asyncio

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from lattice.db import Base
from lattice.db import models as _models  # noqa: F401 - registers every table
from lattice.db.migrate import downgrade, upgrade_async


async def test_session_reaches_postgres(session: AsyncSession) -> None:
    assert await session.scalar(select(text("1"))) == 1


async def test_rows_do_not_leak_between_tests(session: AsyncSession) -> None:
    """Each test runs in its own rolled-back transaction; a scratch table proves it."""
    await session.execute(text("create table scratch (id int)"))
    await session.execute(text("insert into scratch values (1)"))
    assert await session.scalar(text("select count(*) from scratch")) == 1


async def test_rows_do_not_leak_between_tests_again(session: AsyncSession) -> None:
    assert await session.scalar(text("select to_regclass('scratch')")) is None


async def test_schema_matches_models(migrated_database: str) -> None:
    """`alembic revision --autogenerate` on a migrated database must produce nothing."""
    engine = create_async_engine(migrated_database)
    try:
        async with engine.connect() as connection:
            assert await connection.run_sync(_diff) == []
    finally:
        await engine.dispose()


def _diff(connection: Connection) -> list[object]:
    context = MigrationContext.configure(connection, opts={"compare_type": True})
    return compare_metadata(context, Base.metadata)


async def test_migrations_round_trip(migrated_database: str) -> None:
    """Every revision is reversible: head → base drops every table, then head restores them."""
    engine = create_async_engine(migrated_database)
    try:
        await asyncio.to_thread(downgrade, migrated_database, "base")
        async with engine.connect() as connection:
            assert set(Base.metadata.tables) & await _table_names(connection) == set()
        await upgrade_async(migrated_database)
        async with engine.connect() as connection:
            assert set(Base.metadata.tables) <= await _table_names(connection)
    finally:
        await engine.dispose()


async def _table_names(connection) -> set[str]:
    rows = await connection.scalars(
        text("select tablename from pg_tables where schemaname = 'public'")
    )
    return set(rows)
