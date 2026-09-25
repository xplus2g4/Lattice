import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.auth import AuthError, verify_token
from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.db.models import User
from lattice.db.repo import users
from lattice.engine import Engine
from lattice.ingest import Ingest

COURSE_CODE = re.compile(r"^[a-z][a-z0-9]{1,15}$")

SettingsDep = Annotated[Settings, Depends(get_settings)]


class ApiError(HTTPException):
    """An error response with fields beside the message, such as the `request_id` on a 502.

    `HTTPException` with a dict detail nests it under `"detail"`, which hides the message
    from the app; this keeps `detail` a string and puts `fields` next to it in the body.
    Handled in `main.py`.
    """

    def __init__(
        self, status_code: int, detail: str, *, headers: dict[str, str] | None = None, **fields
    ) -> None:
        super().__init__(status_code, detail, headers)
        self.fields = fields

    @property
    def body(self) -> dict:
        return {"detail": self.detail, **self.fields}


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
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]


@dataclass
class Identity:
    """A caller's verified email and how it was proven."""

    email: str
    # True for the dev-only X-User header; False for a verified Bearer token.
    via_header: bool


def current_identity(
    settings: SettingsDep,
    x_user: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    """Bearer token first; the dev X-User header only when DEV_HEADER_AUTH allows it."""
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise HTTPException(401, "Authorization must be a Bearer token")
        try:
            claims = verify_token(settings, token.strip())
        except AuthError as e:
            raise HTTPException(401, str(e)) from e
        return Identity(email=claims["email"].strip().lower(), via_header=False)
    if not settings.dev_header_auth:
        raise HTTPException(401, "a Bearer token is required (DEV_HEADER_AUTH is off)")
    if not x_user or "@" not in x_user:
        raise HTTPException(401, "X-User header must be an email")
    return Identity(email=x_user.strip().lower(), via_header=True)


CurrentIdentity = Annotated[Identity, Depends(current_identity)]


async def current_user(
    identity: CurrentIdentity, session: SessionDep, settings: SettingsDep
) -> User:
    """The caller's `users` row. Strangers need an invite; a configured instructor
    email bootstraps on sign-in, and dev-header callers self-provision. The check
    is sticky: a student row matching an instructor email is promoted back, so
    configuring the email late or signing in via an invite cannot demote them."""
    instructor_emails = {settings.instructor_email.strip().lower()} | {
        e.strip().lower() for e in settings.instructor_emails
    }
    instructor = identity.email in instructor_emails
    user = await users.by_email(session, identity.email)
    if user is None:
        if identity.via_header:
            user = await users.get_or_create(session, identity.email)
        elif instructor:
            user = await users.create(session, email=identity.email, role="instructor")
        else:
            raise HTTPException(403, "an invite is required to join")
    if instructor and user.role == "student":
        await users.update(session, user, role="instructor")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
