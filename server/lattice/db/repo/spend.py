"""The Spend ledger: append attempts, sum the UTC day for the Ceiling."""

from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Spend


async def record(session: AsyncSession, rows: Sequence[Spend]) -> None:
    """Append attempts; the caller's transaction commits them with the Turn or job."""
    session.add_all(rows)


async def today_usd(session: AsyncSession) -> Decimal:
    """Priced Spend since midnight UTC, the window a Ceiling is measured over.

    Unpriced rows (`usd` null) contribute nothing; an empty day is `Decimal("0")`.
    """
    since = text("date_trunc('day', now() at time zone 'utc')")
    total = await session.scalar(
        select(func.coalesce(func.sum(Spend.usd), 0)).where(Spend.occurred_at >= since)
    )
    return Decimal(total)
