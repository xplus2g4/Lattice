"""The Spend ledger's UTC-day window and Product event round-trips."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Course, Spend, User
from lattice.db.repo import product_events, spend

pytestmark = pytest.mark.asyncio


async def a_course(session: AsyncSession) -> tuple[User, Course]:
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    course = Course(code="CS101", name="CS101", owner_user_id=user.id, global_dataset_name="g")
    session.add(course)
    await session.flush()
    return user, course


def attempt(course: Course, *, at: datetime, usd: Decimal | None) -> Spend:
    return Spend(
        occurred_at=at,
        course_id=course.id,
        kind="completion",
        model="gpt-4o-mini",
        prompt_tokens=10,
        usd=usd,
    )


async def test_today_usd_is_empty_when_nothing_was_spent(session: AsyncSession) -> None:
    assert await spend.today_usd(session) == Decimal("0")


async def test_today_usd_starts_at_midnight_utc(session: AsyncSession) -> None:
    _, course = await a_course(session)
    midnight = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    await spend.record(
        session,
        [
            attempt(course, at=midnight - timedelta(seconds=1), usd=Decimal("5")),
            attempt(course, at=midnight, usd=Decimal("0.25")),
            attempt(course, at=midnight + timedelta(minutes=1), usd=Decimal("0.5")),
            attempt(course, at=midnight + timedelta(minutes=2), usd=None),
        ],
    )
    await session.flush()

    assert await spend.today_usd(session) == Decimal("0.75")


async def test_today_usd_is_zero_when_no_attempt_is_priced(session: AsyncSession) -> None:
    _, course = await a_course(session)
    await spend.record(session, [attempt(course, at=datetime.now(UTC), usd=None)])
    await session.flush()

    assert await spend.today_usd(session) == Decimal("0")


async def test_product_event_round_trips_properties(session: AsyncSession) -> None:
    user, course = await a_course(session)
    properties = {"question_len": 42, "used_notes": True, "related_courses": ["CS102"]}

    event = await product_events.record(
        session, user_id=user.id, course_id=course.id, name="ask.asked", properties=properties
    )
    session.expunge(event)

    stored = await session.get(type(event), event.id)
    assert stored is not None
    assert stored.properties == properties
    assert stored.occurred_at.tzinfo is not None
