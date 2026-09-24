"""Course summaries: what stands for a Material, when a refresh is skipped, who is nearest."""

import hashlib
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice.course_summaries import CourseSummaries, first_page_text, mean_pooled
from lattice.db.models import Course, Material, Topic, User
from lattice.db.repo import course_summaries
from tests.conftest import basis

pytestmark = pytest.mark.asyncio


def pdf_with_text(text: str) -> bytes:
    """A one-page PDF whose only content is `text`, small enough to build by hand."""
    stream = f"BT /F1 12 Tf 10 50 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


async def owner(session: AsyncSession) -> User:
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    return user


async def a_course(
    session: AsyncSession,
    user: User,
    tmp_path: Path,
    code: str,
    *files: tuple[str, bytes],
    status: str = "ready",
) -> Course:
    """A course whose Materials are on disk, every one in the given status."""
    course = Course(
        code=code, name=code, owner_user_id=user.id, global_dataset_name=f"{code}-global"
    )
    session.add(course)
    await session.flush()
    for filename, content in files:
        sha256 = hashlib.sha256(content).hexdigest()
        path = tmp_path / code / f"{sha256}{Path(filename).suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        session.add(
            Material(
                course_id=course.id,
                created_by=user.id,
                title=filename,
                filename=filename,
                storage_uri=str(path),
                sha256=sha256,
                status=status,
            )
        )
    await session.commit()
    return course


def refresher(sessionmaker: async_sessionmaker, engine, settings) -> CourseSummaries:
    return CourseSummaries(sessionmaker, engine, settings)


async def test_a_course_is_the_unit_mean_of_its_ready_materials(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """Each Material's record and first Page make one profile; the course is their mean."""
    user = await owner(session)
    course = await a_course(
        session,
        user,
        tmp_path,
        "cs2040",
        ("hashing.pdf", pdf_with_text("Hash tables chain collisions")),
        ("sonnets.md", b"# Sonnets\n\nfourteen lines"),
    )
    hashing = next(m for m in await _materials(session, course) if m.filename == "hashing.pdf")
    session.add(
        Topic(
            material_id=hashing.id,
            label="Collision resolution",
            page_start=1,
            page_end=1,
            position=0,
        )
    )
    await session.commit()
    engine.axes = {"Hash": 1, "Sonnets": 2}

    refreshed = await refresher(sessionmaker, engine, settings).refresh_all()

    assert refreshed == ["cs2040"]
    row = await course_summaries.get(session, course)
    assert row is not None
    assert "hashing.pdf" in row.summary_text
    assert "Topics: Collision resolution" in row.summary_text
    assert "Hash tables chain collisions" in row.summary_text
    assert "Sonnets" in row.summary_text
    assert row.embedding_model == "fake-embedding"
    assert row.embedding[1] == pytest.approx(0.7071, abs=1e-3)
    assert row.embedding[2] == pytest.approx(0.7071, abs=1e-3)
    assert sum(row.embedding[3:]) == 0


async def test_a_course_without_a_ready_material_has_no_summary(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """Nothing cognified means nothing to compare by, and a stale row is dropped."""
    user = await owner(session)
    course = await a_course(
        session, user, tmp_path, "cs2040", ("w1.md", b"queued"), status="queued"
    )
    await course_summaries.upsert(
        session,
        course,
        summary_text="stale",
        embedding=basis(0),
        embedding_model="fake-embedding",
        source_digest="0" * 64,
    )
    await session.commit()

    assert await refresher(sessionmaker, engine, settings).refresh_all() == []
    assert await course_summaries.get(session, course) is None
    assert engine.embedded == []


async def test_an_unchanged_course_is_not_embedded_again(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    user = await owner(session)
    course = await a_course(session, user, tmp_path, "cs2040", ("w1.md", b"week one"))
    summaries = refresher(sessionmaker, engine, settings)

    await summaries.refresh_all()
    assert await summaries.refresh_all() == []
    assert len(engine.embedded) == 1

    (material,) = await _materials(session, course)
    material.title = "Week 1: introduction"
    await session.commit()
    assert await summaries.refresh_all() == ["cs2040"]
    assert len(engine.embedded) == 2


async def test_a_new_embedding_model_forces_a_refresh(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    """Vectors from two models do not share a space, so every row is redone."""
    user = await owner(session)
    course = await a_course(session, user, tmp_path, "cs2040", ("w1.md", b"week one"))
    summaries = refresher(sessionmaker, engine, settings)
    await summaries.refresh_all()

    engine.model_name = "other-model"
    assert await summaries.refresh_all() == ["cs2040"]
    row = await course_summaries.get(session, course)
    assert row is not None and row.embedding_model == "other-model"


async def test_nearest_orders_by_cosine_distance_and_stops_at_the_floor(
    session: AsyncSession, tmp_path
) -> None:
    """Closest first, and nothing below MIN_SIMILARITY even when there is room for it."""
    user = await owner(session)
    cs2040, cs3230, cs2230, ma1521, lit101, unsummarised = [
        await a_course(session, user, tmp_path, code)
        for code in ("cs2040", "cs3230", "cs2230", "ma1521", "lit101", "phy101")
    ]
    one, two = basis(1), basis(2)
    for course, vector in (
        (cs2040, one),
        (cs3230, mean_pooled([one, one, one, two])),  # similarity 0.95 to cs2040
        (cs2230, mean_pooled([one, one, two])),  # 0.89
        (ma1521, mean_pooled([one, two])),  # 0.71, below the floor
        (lit101, two),  # 0
    ):
        await course_summaries.upsert(
            session,
            course,
            summary_text=course.code,
            embedding=vector,
            embedding_model="fake-embedding",
            source_digest="0" * 64,
        )

    assert course_summaries.MIN_SIMILARITY == 0.75
    nearest = await course_summaries.nearest(session, cs2040, 3)
    assert [c.code for c in nearest] == ["cs3230", "cs2230"]
    assert [c.code for c in await course_summaries.nearest(session, cs2040, 1)] == ["cs3230"]
    assert await course_summaries.nearest(session, cs2040, 0) == []
    assert await course_summaries.nearest(session, unsummarised, 3) == []


def test_mean_pooled_is_unit_length() -> None:
    assert mean_pooled([[3.0, 0.0], [0.0, 4.0]]) == pytest.approx([0.6, 0.8])


def test_an_unreadable_material_contributes_no_page_text(tmp_path) -> None:
    assert first_page_text(tmp_path / "missing.pdf") == ""
    (tmp_path / "broken.pdf").write_bytes(b"not a pdf")
    assert first_page_text(tmp_path / "broken.pdf") == ""


async def _materials(session: AsyncSession, course: Course) -> list[Material]:
    from lattice.db.repo import materials

    return await materials.for_course(session, course)
