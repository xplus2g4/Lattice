"""Watchdog: the third lifespan loop, which reads the process's own health and tells one
Telegram chat when something needs a person.

Each tick publishes the ingest queues as Telemetry, then measures a fixed set of alerts:
an ingest queue whose oldest item has waited too long, an ingest or summaries loop that has
stopped ticking, and the day's Spend at 80 % and at 100 % of the Ceiling. Alert state lives
in the instance: a message goes out when an alert starts firing, again every 24 h while it
keeps firing, and once more when it clears. Nothing here can report this process dying;
that is documented in the backlog.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import NamedTuple

from sqlalchemy.ext.asyncio import async_sessionmaker

from lattice import telemetry
from lattice.config import Settings
from lattice.db.repo import spend
from lattice.db.repo import watchdog as queues
from lattice.telegram import Telegram

log = logging.getLogger(__name__)

RESEND_S = 24 * 3600
WATCHED_LOOPS = ("ingest", "summaries")


class Reading(NamedTuple):
    """One alert's measurement this tick: whether it fires, the value that decided it and
    the threshold it was held against, both already rendered for the message."""

    firing: bool
    value: str
    threshold: str


def _seconds(value: float) -> str:
    return f"{value:.0f}s"


class Watchdog:
    def __init__(
        self,
        sessionmaker: async_sessionmaker,
        settings: Settings,
        telegram: Telegram,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.sessionmaker = sessionmaker
        self.settings = settings
        self.telegram = telegram
        self.clock = clock
        self.firing_since: dict[str, float] = {}
        self.last_sent: dict[str, float] = {}

    async def run_forever(self) -> None:
        """Tick every `watchdog_tick_s`; a failed tick is logged and the next one retries."""
        while True:
            telemetry.heartbeat("watchdog")
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 - the next tick retries; the API must keep serving
                log.exception("watchdog tick failed")
            await asyncio.sleep(self.settings.watchdog_tick_s)

    async def tick(self) -> None:
        """Publish the queue gauges, measure every alert, and send whatever changed."""
        now = self.clock()
        ceiling = self.settings.spend_ceiling_usd
        async with self.sessionmaker() as session:
            materials = await queues.material_queue(session)
            notes = await queues.note_queue(session)
            spent = float(await spend.today_usd(session)) if ceiling is not None else None

        oldest: tuple[float, str] | None = None
        for kind, queue in (("material", materials), ("note", notes)):
            for status, depth in queue.depth.items():
                telemetry.INGEST_QUEUE_DEPTH.labels(kind=kind, status=status).set(depth)
            age = 0.0 if queue.oldest is None else max(0.0, now - queue.oldest.timestamp())
            telemetry.INGEST_QUEUE_OLDEST.labels(kind=kind).set(age)
            if queue.oldest is not None and (oldest is None or age > oldest[0]):
                oldest = (age, kind)

        readings = {"ingest_stuck": self._ingest_stuck(oldest)}
        for loop in WATCHED_LOOPS:
            readings[f"loop_stalled:{loop}"] = self._loop_stalled(loop, now)
        readings["ceiling_80"] = self._ceiling(spent, ceiling, 0.8)
        readings["ceiling_100"] = self._ceiling(spent, ceiling, 1.0)
        await self._evaluate(readings, now)

    def _ingest_stuck(self, oldest: tuple[float, str] | None) -> Reading:
        threshold = self.settings.alert_ingest_stuck_s
        if oldest is None:
            return Reading(False, "queues empty", _seconds(threshold))
        age, kind = oldest
        return Reading(age > threshold, f"{_seconds(age)} ({kind})", _seconds(threshold))

    def _loop_stalled(self, loop: str, now: float) -> Reading:
        threshold = self.settings.alert_loop_stalled_s
        last = telemetry.last_tick(loop)
        if last is None:
            return Reading(False, "not started", _seconds(threshold))
        since = now - last
        return Reading(since > threshold, f"{_seconds(since)} since last tick", _seconds(threshold))

    @staticmethod
    def _ceiling(spent: float | None, ceiling: float | None, fraction: float) -> Reading:
        if spent is None or ceiling is None:
            return Reading(False, "no ceiling", "-")
        limit = ceiling * fraction
        return Reading(spent >= limit, f"${spent:.2f}", f"${limit:.2f}")

    async def _evaluate(self, readings: dict[str, Reading], now: float) -> None:
        """Apply the transition table to every alert and send what it says to.

        A message counts as sent once handed to Telegram, delivered or not: a chat that is
        down or unconfigured already produced a log line, and repeating it every tick would
        drown the log without reaching anyone sooner.
        """
        name = self.settings.deployment_name
        for alert_id, reading in readings.items():
            was_firing = alert_id in self.firing_since
            firing = f"[{name}] FIRING {alert_id}: {reading.value} (threshold {reading.threshold})"
            if reading.firing and not was_firing:
                self.firing_since[alert_id] = now
                self.last_sent[alert_id] = now
                await self.telegram.send(firing)
            elif reading.firing and now - self.last_sent[alert_id] >= RESEND_S:
                self.last_sent[alert_id] = now
                await self.telegram.send(firing)
            elif was_firing and not reading.firing:
                del self.firing_since[alert_id]
                del self.last_sent[alert_id]
                await self.telegram.send(f"[{name}] RESOLVED {alert_id}: {reading.value}")
