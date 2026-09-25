"""The Spend ledger behind `/ask`, the Ceiling that refuses at the boundary, and the
Product events an ask leaves behind."""

import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice import telemetry
from lattice.db.models import Course, ProductEvent, Spend, User
from lattice.db.repo import courses
from lattice.ingest import Ingest
from lattice.spend import Attribution, SpendLogger, collect
from tests.test_ask import answering, ask  # noqa: F401 - fixture reused by name
from tests.test_ingest import a_material
from tests.test_materials import join

pytestmark = pytest.mark.asyncio

PRICES = {"gpt-4o-mini": {"input": 0.15, "output": 0.60}}
COMPLETION = {"model": "openai/gpt-4o-mini", "call_type": "acompletion"}


def response(prompt: int, completion: int) -> SimpleNamespace:
    """What litellm hands the callback: an object with a `usage` block."""
    return SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=prompt, completion_tokens=completion, prompt_tokens_details=None
        )
    )


@pytest.fixture
def logger(settings) -> SpendLogger:
    settings.spend_prices_usd_per_1m = PRICES
    return SpendLogger(settings)


@pytest.fixture
def billed(answering, logger: SpendLogger, monkeypatch):  # noqa: F811 - pytest fixture
    """Every search is one provider attempt of 1000 prompt and 100 completion tokens."""
    original = answering.search

    async def search(*args, **kwargs):
        await logger.async_log_success_event(COMPLETION, response(1000, 100), None, None)
        return await original(*args, **kwargs)

    monkeypatch.setattr(answering, "search", search)
    return answering


async def ledger(session: AsyncSession) -> list[Spend]:
    return list(await session.scalars(select(Spend).order_by(Spend.occurred_at)))


def counted(course: str, outcome: str) -> float:
    return (
        telemetry.REGISTRY.get_sample_value(
            "ask_outcome_total", {"course": course, "outcome": outcome}
        )
        or 0.0
    )


async def test_an_ask_is_billed_to_its_turn_and_principal(
    student: AsyncClient, billed, session: AsyncSession
) -> None:
    await join(student)

    answered = await ask(student)

    (row,) = await ledger(session)
    ada = await session.scalar(select(User).where(User.email == "ada@example.com"))
    assert (str(row.turn_id), row.user_id) == (answered["turn"]["id"], ada.id)
    assert (row.kind, row.model) == ("completion", "gpt-4o-mini")
    assert (row.prompt_tokens, row.completion_tokens, row.cached_tokens) == (1000, 100, 0)
    assert row.usd == Decimal("0.000210")


async def seed(session: AsyncSession, code: str, *amounts: str) -> None:
    course = await courses.by_code(session, code)
    session.add_all(
        Spend(
            course_id=course.id,
            kind="completion",
            model="gpt-4o-mini",
            prompt_tokens=1,
            usd=Decimal(amount),
        )
        for amount in amounts
    )
    await session.flush()


async def test_the_ceiling_refuses_at_the_boundary_not_below_it(
    student: AsyncClient,
    answering,  # noqa: F811
    session: AsyncSession,
    settings,
) -> None:
    settings.spend_ceiling_usd = 1.0
    await join(student)
    refused_before = counted("cs3216", "refused_budget")

    await seed(session, "cs3216", "0.5", "0.499")
    under = await student.post("/ask", json={"course": "cs3216", "question": "hi"})
    assert under.status_code == 200

    await seed(session, "cs3216", "0.001")
    refused = await student.post("/ask", json={"course": "cs3216", "question": "hi"})

    assert refused.status_code == 429
    body = refused.json()
    assert body["detail"] == "daily spend ceiling reached"
    reset_at = datetime.fromisoformat(body["reset_at"])
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    assert reset_at == tomorrow.replace(hour=0, minute=0, second=0, microsecond=0)
    assert 0 < int(refused.headers["retry-after"]) <= 24 * 3600
    assert counted("cs3216", "refused_budget") == refused_before + 1
    # Nothing was answered: no Turn, and the searches never ran.
    assert len(answering.searched) == 1


async def test_concurrent_attempts_share_one_collector(
    session: AsyncSession, logger: SpendLogger
) -> None:
    """The search lanes of `/ask` are gathered; each child copies the context and appends
    to the same Collector, so one flush carries them all."""
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    course = Course(code="cs3216", name="SE", owner_user_id=user.id, global_dataset_name="g")
    session.add(course)
    await session.flush()

    async with collect(session, Attribution(user_id=user.id, course_id=course.id)):
        await asyncio.gather(
            logger.async_log_success_event(COMPLETION, response(10, 1), None, None),
            logger.async_log_success_event(
                {"model": "text-embedding-3-small", "call_type": "aembedding"},
                {"usage": {"prompt_tokens": 7, "completion_tokens": 0}},
                None,
                None,
            ),
        )

    rows = await ledger(session)
    assert sorted((r.kind, r.prompt_tokens, r.usd) for r in rows) == [
        ("completion", 10, Decimal("0.000002")),
        ("embedding", 7, None),
    ]
    assert {r.user_id for r in rows} == {user.id}


async def test_an_attempt_outside_any_scope_is_counted_not_written(
    session: AsyncSession, logger: SpendLogger
) -> None:
    before = (
        telemetry.REGISTRY.get_sample_value(
            "llm_calls_total",
            {"kind": "completion", "model": "gpt-4o-mini", "outcome": "unattributed"},
        )
        or 0.0
    )

    await logger.async_log_success_event(COMPLETION, response(5, 5), None, None)
    await logger.async_log_failure_event(COMPLETION, RuntimeError("boom"), None, None)

    assert await ledger(session) == []
    after = telemetry.REGISTRY.get_sample_value(
        "llm_calls_total",
        {"kind": "completion", "model": "gpt-4o-mini", "outcome": "unattributed"},
    )
    assert after == before + 2


async def test_a_failed_attempt_without_usage_is_a_zero_token_row(
    session: AsyncSession, logger: SpendLogger
) -> None:
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    course = Course(code="cs3216", name="SE", owner_user_id=user.id, global_dataset_name="g")
    session.add(course)
    await session.flush()

    async with collect(session, Attribution(user_id=None, course_id=course.id)):
        await logger.async_log_failure_event(COMPLETION, RuntimeError("timeout"), None, None)

    (row,) = await ledger(session)
    assert (row.prompt_tokens, row.completion_tokens, row.usd) == (0, 0, Decimal("0"))


async def test_an_ask_leaves_events_with_a_hash_and_no_text(
    student: AsyncClient,
    answering,  # noqa: F811
    session: AsyncSession,
) -> None:
    await join(student)
    question = "when are hash tables?"

    answered = await ask(student, question)

    events = {
        e.name: e
        for e in await session.scalars(select(ProductEvent).where(ProductEvent.name.like("ask.%")))
    }
    asked, done = events["ask.asked"], events["ask.answered"]
    assert asked.course_id == done.course_id
    assert asked.properties["question_sha256"] == hashlib.sha256(question.encode()).hexdigest()
    assert asked.properties["question_len"] == len(question)
    assert question not in str(asked.properties) and question not in str(done.properties)
    assert asked.properties["session_id"] == answered["session"]
    assert done.properties["turn_id"] == answered["turn"]["id"]
    assert (done.properties["citations"], done.properties["empty_answer"]) == (2, False)


async def test_ingest_under_the_ceiling_fails_the_material_without_the_engine(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    settings.spend_ceiling_usd = 1.0
    session.add(
        Spend(
            course_id=material.course_id,
            kind="completion",
            model="gpt-4o-mini",
            prompt_tokens=1,
            usd=Decimal("1"),
        )
    )
    await session.commit()

    await Ingest(sessionmaker, engine, settings).material(material.id)

    await session.refresh(material)
    assert material.status == "failed"
    assert material.error.startswith("Ceiling reached; retry after ")
    assert engine.cognified == []
    (event,) = await session.scalars(
        select(ProductEvent).where(ProductEvent.name == "material.failed")
    )
    assert event.properties == {"material_id": str(material.id), "attempts": 1}
