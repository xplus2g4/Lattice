"""Product events, appended inside the action's own transaction."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import ProductEvent


async def record(
    session: AsyncSession,
    *,
    user_id: UUID,
    course_id: UUID | None,
    name: str,
    properties: dict[str, Any],
) -> ProductEvent:
    """Add one Product event; the caller commits it together with the action it describes."""
    event = ProductEvent(user_id=user_id, course_id=course_id, name=name, properties=properties)
    session.add(event)
    await session.flush()
    return event
