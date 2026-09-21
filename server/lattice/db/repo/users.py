from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import User


async def by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == email))


async def get_or_create(session: AsyncSession, email: str) -> User:
    """The app user behind an authenticated email; created on first sight."""
    user = await by_email(session, email)
    if user is None:
        user = User(email=email)
        session.add(user)
        await session.flush()
    return user


async def update(
    session: AsyncSession,
    user: User,
    *,
    name: str | None = None,
    notes_opt_out: bool | None = None,
) -> User:
    if name is not None:
        user.name = name
    if notes_opt_out is not None:
        user.notes_opt_out = notes_opt_out
    await session.flush()
    return user


async def set_principal(session: AsyncSession, user: User, principal_id: UUID) -> None:
    user.cognee_principal_id = principal_id
    await session.flush()
