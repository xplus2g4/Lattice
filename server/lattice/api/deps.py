import re
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.auth import ACCESS_COOKIE, read_access_email
from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.db.models import User
from lattice.db.repo import users
from lattice.engine import Engine
from lattice.ingest import Ingest

COURSE_CODE = re.compile(r"^[a-z][a-z0-9]{1,15}$")

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_engine(request: Request) -> Engine:
    return request.app.state.engine


def get_ingest(request: Request) -> Ingest:
    return request.app.state.ingest


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    database: Database = request.app.state.database
    async for session in database.session():
        yield session


EngineDep = Annotated[Engine, Depends(get_engine)]
IngestDep = Annotated[Ingest, Depends(get_ingest)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def current_email(
    request: Request,
    settings: SettingsDep,
    x_user: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    """The caller's email: the access cookie or Bearer token first, then the
    dev-only `X-User` header when `DEV_HEADER_AUTH` is on."""
    token = request.cookies.get(ACCESS_COOKIE)
    if token is None and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip() or None
    if token is not None and (email := read_access_email(settings, token)) is not None:
        return email
    if settings.dev_header_auth and x_user and "@" in x_user:
        return x_user.strip().lower()
    raise HTTPException(401, "not signed in")


CurrentEmail = Annotated[str, Depends(current_email)]


async def current_user(email: CurrentEmail, session: SessionDep, settings: SettingsDep) -> User:
    """The caller's `users` row, created on first sight; `ADMIN_EMAILS` are promoted here."""
    return await users.get_or_create(session, email, admin_emails=settings.admin_emails)


CurrentUser = Annotated[User, Depends(current_user)]


def require_role(*roles: str) -> Callable[[User], Awaitable[User]]:
    """Gate an endpoint on `users.role`. Enrolment still decides what a role may read."""

    async def dep(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"requires {' or '.join(roles)} role")
        return user

    return dep


AdminUser = Annotated[User, Depends(require_role("admin"))]
