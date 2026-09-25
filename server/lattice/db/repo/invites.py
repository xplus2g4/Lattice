"""Invite queries: token hashing and the single-use burn live here."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Invite, User


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create(
    session: AsyncSession, *, role: str, ttl: timedelta, created_by: UUID | None
) -> tuple[Invite, str]:
    """A new Invite plus its raw token — the only time the token leaves the server."""
    token = secrets.token_urlsafe(32)
    invite = Invite(
        token_hash=_hash(token),
        role=role,
        expires_at=datetime.now(UTC) + ttl,
        created_by=created_by,
    )
    session.add(invite)
    await session.flush()
    return invite, token


async def by_token(session: AsyncSession, token: str) -> Invite | None:
    return await session.scalar(select(Invite).where(Invite.token_hash == _hash(token)))


async def list_all(session: AsyncSession) -> list[Invite]:
    """Every invite ever minted, newest first. Token hashes never leave this module."""
    return list(await session.scalars(select(Invite).order_by(Invite.created_at.desc())))


def usable(invite: Invite | None) -> bool:
    return invite is not None and invite.used_at is None and invite.expires_at > datetime.now(UTC)


async def burn(session: AsyncSession, invite: Invite, user: User) -> None:
    invite.used_at = datetime.now(UTC)
    invite.used_by = user.id
    await session.flush()
