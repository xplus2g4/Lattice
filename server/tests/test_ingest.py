"""The background ingest: it owns the Material's status, success or failure."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice.db.models import Course, Material, Note, User
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
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)

    await Ingest(sessionmaker, engine, settings).material(material.id)

    await session.refresh(material)
    assert material.status == "ready"
    assert material.error is None
    assert engine.cognified == [str(tmp_path / "week1.pdf")]


async def test_a_failure_is_recorded_on_the_material(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    engine.fail_with = RuntimeError("cognee is down")

    await Ingest(sessionmaker, engine, settings).material(material.id)

    await session.refresh(material)
    assert material.status == "failed"
    assert material.error == "RuntimeError: cognee is down"


async def test_a_missing_material_is_not_an_error(
    sessionmaker: async_sessionmaker, engine, settings
) -> None:
    await Ingest(sessionmaker, engine, settings).material(uuid4())


async def test_a_note_is_cognified_into_its_authors_private_dataset(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    note = Note(
        user_id=material.created_by,
        course_id=material.course_id,
        material_id=material.id,
        page=4,
        body_md="hash tables are week 3",
    )
    session.add(note)
    await session.commit()

    await Ingest(sessionmaker, engine, settings).note(note.id)

    await session.refresh(note)
    assert note.status == "ready"
    assert engine.enrolled == [("cs3216", "ada@example.com")]
    written = settings.uploads_dir / "cs3216" / "notes"
    assert [path.read_text() for path in written.rglob("*.md")] == ["hash tables are week 3"]


async def test_a_failed_note_keeps_its_body(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    note = Note(user_id=material.created_by, course_id=material.course_id, body_md="still here")
    session.add(note)
    await session.commit()
    engine.fail_with = RuntimeError("cognee is down")

    await Ingest(sessionmaker, engine, settings).note(note.id)

    await session.refresh(note)
    assert (note.status, note.body_md) == ("failed", "still here")
    assert note.error == "RuntimeError: cognee is down"
