"""Spend: the ledger of what each LLM call cost, and the Ceiling that caps a UTC day.

Every provider attempt litellm makes reaches `SpendLogger`, which turns it into a pending
`Spend` row on the current `Collector`. The collector lives in a `ContextVar`, so the
concurrent search lanes of `/ask` (an `asyncio.gather`, whose children copy the context)
all append to the same one. `collect(...)` opens an attributed scope and, on exit, writes
the rows through `repo.spend.record`; Turn Spend is flushed in the request's own session
so the rows commit with the Turn they cite.

The Ceiling is read from the same ledger: `check_ceiling` refuses once today's priced Spend
reaches `spend_ceiling_usd`, and `next_reset` says when the window turns over.
"""

import contextlib
import logging
import math
from collections.abc import AsyncIterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

import litellm
from litellm.integrations.custom_logger import CustomLogger
from litellm.litellm_core_utils.logging_worker import GLOBAL_LOGGING_WORKER
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice import telemetry
from lattice.config import Settings
from lattice.db.models import Spend
from lattice.db.repo import spend as repo
from lattice.logging import request_id

log = logging.getLogger(__name__)

MICRO_USD = Decimal("0.000001")
PER_MILLION = Decimal(1_000_000)


@dataclass
class Attribution:
    """Who a batch of attempts is billed to: always a course; a Principal for Turn Spend;
    the Turn, Material or Note it served when there is one. `course_code` only labels
    Telemetry, which never carries ids."""

    user_id: UUID | None
    course_id: UUID
    turn_id: UUID | None = None
    material_id: UUID | None = None
    note_id: UUID | None = None
    course_code: str | None = None


@dataclass
class Collector:
    """Pending rows plus the Attribution they will be flushed with. `attribution` is
    mutable so `/ask` can name the assistant Turn once it exists."""

    attribution: Attribution
    rows: list[Spend] = field(default_factory=list)


_current: ContextVar[Collector | None] = ContextVar("spend_collector", default=None)


class CeilingReached(Exception):
    """Today's Spend has reached the Ceiling; nothing that costs money may start."""

    def __init__(self, reset_at: datetime) -> None:
        super().__init__(f"daily spend ceiling reached; resets at {reset_at.isoformat()}")
        self.reset_at = reset_at


def next_reset() -> datetime:
    """The next midnight UTC, when the Ceiling's window turns over."""
    now = datetime.now(UTC)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


async def ceiling_fraction(db: AsyncSession, settings: Settings) -> float | None:
    """How much of today's Ceiling is spent, 0.0 to 1.0 and beyond; None without a Ceiling."""
    ceiling = settings.spend_ceiling_usd
    if ceiling is None:
        return None
    spent = float(await repo.today_usd(db))
    return spent / ceiling if ceiling > 0 else math.inf


async def check_ceiling(db: AsyncSession, settings: Settings) -> None:
    """Raise `CeilingReached` once today's priced Spend has reached the Ceiling."""
    ceiling = settings.spend_ceiling_usd
    if ceiling is None:
        return
    if await repo.today_usd(db) >= Decimal(str(ceiling)):
        raise CeilingReached(next_reset())


def _field(obj: Any, name: str) -> Any:
    """litellm hands usage as a pydantic object or, on some paths, a dict."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _usage(response_obj: Any) -> tuple[int, int, int]:
    """(prompt, completion, cached) tokens; a failure without a usage block is all zeros."""
    usage = _field(response_obj, "usage")
    prompt = int(_field(usage, "prompt_tokens") or 0)
    completion = int(_field(usage, "completion_tokens") or 0)
    cached = int(_field(_field(usage, "prompt_tokens_details"), "cached_tokens") or 0)
    return prompt, completion, cached


def price(settings: Settings, model: str, prompt: int, completion: int) -> Decimal | None:
    """USD for one attempt from the configured table; None when the model is unpriced."""
    row = settings.price_for(model)
    if row is None:
        return None
    usd = (
        Decimal(prompt) * Decimal(str(row.get("input", 0.0)))
        + Decimal(completion) * Decimal(str(row.get("output", 0.0)))
    ) / PER_MILLION
    return usd.quantize(MICRO_USD)


class SpendLogger(CustomLogger):
    """litellm callback: one `Spend` row per provider attempt, on the current Collector.

    Never raises into litellm: a broken ledger must not fail the completion it describes.
    An attempt outside any `collect` scope is counted as `unattributed` and logged at
    WARNING rather than dropped silently.
    """

    def __init__(self, settings: Settings) -> None:
        super().__init__()
        self.settings = settings

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time) -> None:
        self._record(kwargs, response_obj, failed=False)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time) -> None:
        self._record(kwargs, response_obj, failed=True)

    def _record(self, kwargs: dict[str, Any], response_obj: Any, *, failed: bool) -> None:
        try:
            model = str(kwargs.get("model") or "unknown").rpartition("/")[2]
            call_type = str(kwargs.get("call_type") or "")
            kind = "embedding" if "embedding" in call_type else "completion"
            prompt, completion, cached = _usage(response_obj)
            collector = _current.get()
            outcome = "unattributed" if collector is None else ("error" if failed else "ok")
            telemetry.LLM_CALLS.labels(kind=kind, model=model, outcome=outcome).inc()
            tokens = telemetry.LLM_TOKENS.labels
            tokens(kind=kind, model=model, direction="prompt").inc(prompt)
            tokens(kind=kind, model=model, direction="completion").inc(completion)
            tokens(kind=kind, model=model, direction="cached").inc(cached)
            if collector is None:
                log.warning("unattributed %s call to %s: no spend collector", kind, model)
                return
            collector.rows.append(
                Spend(
                    course_id=collector.attribution.course_id,
                    kind=kind,
                    model=model,
                    prompt_tokens=prompt,
                    completion_tokens=completion,
                    cached_tokens=cached,
                    usd=price(self.settings, model, prompt, completion),
                    request_id=request_id.get(),
                )
            )
        except Exception:  # noqa: BLE001 - the ledger never fails the call it describes
            log.exception("spend callback failed")


def register(settings: Settings) -> None:
    """Put one `SpendLogger` on `litellm.callbacks`; a second `create_app` finds it there."""
    if not any(isinstance(callback, SpendLogger) for callback in litellm.callbacks):
        litellm.callbacks.append(SpendLogger(settings))


@contextlib.asynccontextmanager
async def collect(
    db: AsyncSession | async_sessionmaker, attribution: Attribution
) -> AsyncIterator[Collector]:
    """Attribute every provider attempt made inside the block. On exit the rows are written
    with the attribution as it stands then: into `db` when given a session (the caller's
    transaction commits them beside the Turn), or in a session of its own, committed here,
    when given a sessionmaker (ingest and summaries hold no request session). Rows are
    flushed even when the block raises: a failed Cognify still cost money."""
    collector = Collector(attribution)
    token = _current.set(collector)
    try:
        yield collector
    finally:
        _current.reset(token)
        await _flush(db, collector)


async def _flush(db: AsyncSession | async_sessionmaker, collector: Collector) -> None:
    # litellm runs callbacks on a background worker; wait for the ones enqueued in this
    # scope before reading the rows, or an attempt finishing late lands after the flush.
    await GLOBAL_LOGGING_WORKER.flush()
    rows = collector.rows
    if not rows:
        return
    who = collector.attribution
    course = who.course_code or str(who.course_id)
    for row in rows:
        row.user_id = who.user_id
        row.course_id = who.course_id
        row.turn_id = who.turn_id
        row.material_id = who.material_id
        row.note_id = who.note_id
        if row.usd is not None:
            telemetry.SPEND_USD.labels(kind=row.kind, model=row.model, course=course).inc(
                float(row.usd)
            )
    if isinstance(db, AsyncSession):
        await repo.record(db, rows)
        return
    async with db() as session:
        await repo.record(session, rows)
        await session.commit()
