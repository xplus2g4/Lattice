import re
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.engine import Engine
from lattice.registry import Registry

COURSE_CODE = re.compile(r"^[a-z][a-z0-9]{1,15}$")

CourseCode = Annotated[str, Path(pattern=COURSE_CODE.pattern)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_engine(request: Request) -> Engine:
    return request.app.state.engine


def get_registry(request: Request) -> Registry:
    return request.app.state.registry


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    database: Database = request.app.state.database
    async for session in database.session():
        yield session


EngineDep = Annotated[Engine, Depends(get_engine)]
RegistryDep = Annotated[Registry, Depends(get_registry)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def current_email(
    settings: SettingsDep,
    x_user: Annotated[str | None, Header()] = None,
) -> str:
    """The app user's email. Dev-only header identity; OAuth replaces this dependency."""
    if not settings.dev_header_auth:
        raise HTTPException(401, "no authentication configured (DEV_HEADER_AUTH is off)")
    if not x_user or "@" not in x_user:
        raise HTTPException(401, "X-User header must be an email")
    return x_user.strip().lower()


CurrentEmail = Annotated[str, Depends(current_email)]
