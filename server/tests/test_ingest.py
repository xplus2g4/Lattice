"""The background ingest: it owns the Material's status, success or failure."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice.db.models import Course, Material, User
from lattice.ingest import Ingest

pytestmark = pytest.mark.asyncio


async def a_material(session: AsyncSession, tmp_path) -> Material:
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    course = Course(
        code="cs3216",
        name="Software Engineering",
        owner_user_id=user.id,
        global_dataset_name="cs3216-global",
    )
    session.add(course)
    await session.flush()
    path = tmp_path / "week1.pdf"
    path.write_bytes(b"week one slides")
    material = Material(
        course_id=course.id,
        created_by=user.id,
        title="week1.pdf",
        filename="week1.pdf",
        storage_uri=str(path),
        sha256="0" * 64,
    )
    session.add(material)
    await session.commit()
    return material


async def test_a_cognified_material_ends_ready(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, tmp_path
) -> None:
    material = await a_material(session, tmp_path)

    await Ingest(sessionmaker, engine).material(material.id)

    await session.refresh(material)
    assert material.status == "ready"
    assert material.error is None
    assert engine.cognified == [str(tmp_path / "week1.pdf")]


async def test_a_failure_is_recorded_on_the_material(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    engine.fail_with = RuntimeError("cognee is down")

    await Ingest(sessionmaker, engine).material(material.id)

    await session.refresh(material)
    assert material.status == "failed"
    assert material.error == "RuntimeError: cognee is down"


async def test_a_missing_material_is_not_an_error(sessionmaker: async_sessionmaker, engine) -> None:
    from uuid import uuid4

    await Ingest(sessionmaker, engine).material(uuid4())
