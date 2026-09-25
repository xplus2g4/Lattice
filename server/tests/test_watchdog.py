"""The watchdog's alert transitions, and what counts as a stuck ingest queue."""

import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice import telemetry
from lattice.config import Settings
from lattice.db.models import Course, Material, Note, User
from lattice.telegram import Telegram
from lattice.watchdog import Reading, Watchdog

HOUR = 3600


class RecordingTelegram:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send(self, text: str) -> bool:
        self.sent.append(text)
        return True


def watchdog(settings: Settings, telegram: RecordingTelegram, sessionmaker=None) -> Watchdog:
    settings.deployment_name = "lattice-test"
    return Watchdog(sessionmaker, settings, telegram)  # type: ignore[arg-type]


def stuck(firing: bool) -> dict[str, Reading]:
    return {"ingest_stuck": Reading(firing, "1200s (material)", "600s")}


async def test_an_alert_messages_on_enter_daily_while_firing_and_on_recover(settings) -> None:
    telegram = RecordingTelegram()
    dog = watchdog(settings, telegram)

    await dog._evaluate(stuck(True), now=0)
    assert telegram.sent == [
        "[lattice-test] FIRING ingest_stuck: 1200s (material) (threshold 600s)"
    ]

    await dog._evaluate(stuck(True), now=23 * HOUR)
    assert len(telegram.sent) == 1

    await dog._evaluate(stuck(True), now=24 * HOUR)
    assert len(telegram.sent) == 2
    assert telegram.sent[1] == telegram.sent[0]

    await dog._evaluate(stuck(False), now=25 * HOUR)
    assert telegram.sent[2] == "[lattice-test] RESOLVED ingest_stuck: 1200s (material)"
    assert dog.firing_since == {}

    # Cleared and quiet: nothing more, and the next entry starts a fresh cycle.
    await dog._evaluate(stuck(False), now=26 * HOUR)
    await dog._evaluate(stuck(True), now=27 * HOUR)
    assert len(telegram.sent) == 4


async def test_an_alert_that_never_fires_never_messages(settings) -> None:
    telegram = RecordingTelegram()
    dog = watchdog(settings, telegram)

    for hour in range(0, 72, 6):
        await dog._evaluate(stuck(False), now=hour * HOUR)

    assert telegram.sent == []


async def test_alerts_transition_independently(settings) -> None:
    telegram = RecordingTelegram()
    dog = watchdog(settings, telegram)
    readings = {
        "ceiling_80": Reading(True, "$8.50", "$8.00"),
        "ceiling_100": Reading(False, "$8.50", "$10.00"),
    }

    await dog._evaluate(readings, now=0)
    readings["ceiling_100"] = Reading(True, "$10.20", "$10.00")
    await dog._evaluate(readings, now=HOUR)

    assert telegram.sent == [
        "[lattice-test] FIRING ceiling_80: $8.50 (threshold $8.00)",
        "[lattice-test] FIRING ceiling_100: $10.20 (threshold $10.00)",
    ]


async def seed(session: AsyncSession) -> tuple[User, Course]:
    user = User(email="ada@example.com")
    session.add(user)
    await session.flush()
    course = Course(code="cs101", name="CS101", owner_user_id=user.id, global_dataset_name="g")
    session.add(course)
    await session.flush()
    return user, course


def a_note(user: User, course: Course, *, attempts: int, age: timedelta) -> Note:
    return Note(
        user_id=user.id,
        course_id=course.id,
        body_md="scribbles",
        status="dirty",
        ingest_attempts=attempts,
        updated_at=datetime.now(UTC) - age,
    )


def ingest_alerts(telegram: RecordingTelegram) -> list[str]:
    """Only this alert: an earlier test's `heartbeat` can leave a loop looking stalled."""
    return [text for text in telegram.sent if "ingest_stuck" in text]


async def test_tick_fires_on_a_queued_material_but_not_a_note_at_the_retry_cap(
    session: AsyncSession, sessionmaker: async_sessionmaker, settings
) -> None:
    telegram = RecordingTelegram()
    dog = watchdog(settings, telegram, sessionmaker)
    user, course = await seed(session)
    session.add(a_note(user, course, attempts=3, age=timedelta(minutes=20)))
    await session.flush()
    await dog.tick()
    assert ingest_alerts(telegram) == []
    assert telemetry.INGEST_QUEUE_OLDEST.labels(kind="note")._value.get() == 0
    assert telemetry.INGEST_QUEUE_DEPTH.labels(kind="note", status="dirty")._value.get() == 0

    session.add(
        Material(
            course_id=course.id,
            created_by=user.id,
            title="Week 1",
            filename="w1.pdf",
            storage_uri="/nowhere/w1.pdf",
            sha256="0" * 64,
            status="queued",
            updated_at=datetime.now(UTC) - timedelta(minutes=20),
        )
    )
    await session.flush()

    await dog.tick()
    [fired] = ingest_alerts(telegram)
    assert fired.startswith("[lattice-test] FIRING ingest_stuck: ")
    assert fired.endswith("s (material) (threshold 600s)")
    assert telemetry.INGEST_QUEUE_DEPTH.labels(kind="material", status="queued")._value.get() == 1
    assert telemetry.INGEST_QUEUE_OLDEST.labels(kind="material")._value.get() > 600


async def test_telegram_logs_instead_of_sending_when_unconfigured(settings) -> None:
    telegram = Telegram(settings)
    lines: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = lines.append
    log = logging.getLogger("lattice.telegram")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        assert await telegram.send("hello") is False
    finally:
        log.removeHandler(handler)
        log.setLevel(logging.NOTSET)

    assert [(line.levelno, "hello" in line.getMessage()) for line in lines] == [
        (logging.INFO, True)
    ]


async def test_telegram_posts_to_the_bot_and_reports_rejections(settings) -> None:
    settings.telegram_bot_token = "123:abc"
    settings.telegram_chat_id = "42"
    requests: list[httpx.Request] = []
    status = 200

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json={"ok": status == 200})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    telegram = Telegram(settings, client)

    assert await telegram.send("hello") is True
    assert requests[0].url == "https://api.telegram.org/bot123:abc/sendMessage"
    assert requests[0].read() == b'{"chat_id":"42","text":"hello"}'

    status = 401
    assert await telegram.send("hello") is False
