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


async def test_a_file_note_hands_the_stored_pdf_to_the_engine(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    pdf = tmp_path / "summary.pdf"
    pdf.write_bytes(b"my summary")
    note = Note(
        user_id=material.created_by,
        course_id=material.course_id,
        body_md="",
        filename="summary.pdf",
        sha256="1" * 64,
        storage_uri=str(pdf),
    )
    session.add(note)
    await session.commit()

    await Ingest(sessionmaker, engine, settings).note(note.id)

    await session.refresh(note)
    assert note.status == "ready"
    assert engine.cognified == [str(pdf)]
    # No Markdown stand-in is written for a PDF Note; the stored file is what gets cognified.
    assert list((settings.uploads_dir / "cs3216" / "notes").rglob("*.md")) == []


async def test_materials_left_mid_ingest_are_requeued_on_restart(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """The background task that owned a queued or cognifying Material died with the process."""
    interrupted = await a_material(session, tmp_path)
    interrupted.status = "cognifying"
    finished = Material(
        course_id=interrupted.course_id,
        created_by=interrupted.created_by,
        title="week2.pdf",
        filename="week2.pdf",
        storage_uri=str(tmp_path / "week2.pdf"),
        sha256="2" * 64,
        status="ready",
    )
    session.add(finished)
    await session.commit()

    restarted = Ingest(sessionmaker, engine, settings)
    assert await restarted.recover_materials() == [interrupted.id]

    await session.refresh(interrupted)
    await session.refresh(finished)
    assert (interrupted.status, finished.status) == ("queued", "ready")
    await restarted.material(interrupted.id)
    await session.refresh(interrupted)
    assert interrupted.status == "ready"


async def test_startup_schedules_the_recovered_materials(app, ingest) -> None:
    """Start-up hands each recovered id to the same ingest the upload endpoint uses."""
    ingest.recovered = [uuid4(), uuid4()]

    async with app.router.lifespan_context(app):
        pass

    assert ingest.queued == ingest.recovered


async def queued_materials(session: AsyncSession, tmp_path, count: int) -> list[Material]:
    """`count` queued Materials in one course, uploaded in order."""
    first = await a_material(session, tmp_path)
    rows = [first]
    for i in range(2, count + 1):
        row = Material(
            course_id=first.course_id,
            created_by=first.created_by,
            title=f"week{i}.pdf",
            filename=f"week{i}.pdf",
            storage_uri=str(tmp_path / f"week{i}.pdf"),
            sha256=f"{i:064d}",
        )
        session.add(row)
        await session.flush()
        rows.append(row)
    await session.commit()
    return rows


async def test_queued_materials_of_a_course_go_to_the_engine_as_one_batch(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """ADR 0007: one Cognify call for the batch; later kicks find their file already done."""
    rows = await queued_materials(session, tmp_path, 3)
    ingest = Ingest(sessionmaker, engine, settings)

    await ingest.material(rows[0].id)
    await ingest.material(rows[1].id)

    assert engine.batches == [[str(tmp_path / f"week{i}.pdf") for i in (1, 2, 3)]]
    for row in rows:
        await session.refresh(row)
    assert [row.status for row in rows] == ["ready"] * 3


async def test_a_failing_batch_falls_back_to_one_file_at_a_time(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """Cognee fails the whole batch for one bad file; only that file may end failed."""
    rows = await queued_materials(session, tmp_path, 3)
    engine.fail_paths = {str(tmp_path / "week2.pdf")}

    await Ingest(sessionmaker, engine, settings).material(rows[0].id)

    assert len(engine.batches) == 1
    assert engine.cognified == [str(tmp_path / "week1.pdf"), str(tmp_path / "week3.pdf")]
    for row in rows:
        await session.refresh(row)
    assert [row.status for row in rows] == ["ready", "failed", "ready"]
    assert rows[1].error == f"RuntimeError: cannot cognify {tmp_path / 'week2.pdf'}"


async def test_a_batch_takes_at_most_ten_files(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    rows = await queued_materials(session, tmp_path, 11)
    ingest = Ingest(sessionmaker, engine, settings)

    await ingest.material(rows[0].id)
    await session.refresh(rows[10])
    assert len(engine.batches[0]) == 10 and rows[10].status == "queued"

    await ingest.material(rows[10].id)
    await session.refresh(rows[10])
    assert engine.cognified[-1] == str(tmp_path / "week11.pdf") and rows[10].status == "ready"
