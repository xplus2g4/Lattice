"""Signing in: the Google OAuth exchange, a dev-only login, refresh, and sign-out.

Both logins end the same way: a `users` row (created on first sight, gated on the
invitation code when one is configured) and the token pair — an access cookie plus a
refresh cookie scoped to `/auth`. Everything after that is `deps.current_email`
reading the access cookie, and `/auth/refresh` minting a new pair.
"""

from fastapi import APIRouter, HTTPException, Request, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import SessionDep, SettingsDep
from lattice.api.schemas import UserOut
from lattice.auth import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    REFRESH_COOKIE_PATH,
    issue_access,
    issue_refresh,
    read_refresh_subject,
)
from lattice.config import Settings
from lattice.db.models import User
from lattice.db.repo import users

router = APIRouter(tags=["auth"])


class GoogleLogin(BaseModel):
    credential: str
    invitation_code: str | None = None


class DevLogin(BaseModel):
    email: str
    invitation_code: str | None = None


def _set_session_cookies(response: Response, settings: Settings, user: User) -> None:
    secure = not settings.dev_header_auth
    response.set_cookie(
        ACCESS_COOKIE,
        issue_access(settings, user.id, user.email),
        max_age=settings.access_token_ttl_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        issue_refresh(settings, user.id),
        max_age=settings.refresh_token_ttl_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=secure,
        # Scoped to the auth endpoints: it is a credential for minting access
        # tokens, not something every request needs to carry.
        path=REFRESH_COOKIE_PATH,
    )


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


def _check_invitation(settings: Settings, code: str | None) -> None:
    """First sight of an email needs the invitation code when one is configured."""
    if settings.invitation_code and code != settings.invitation_code:
        raise HTTPException(403, "an invitation code is required to sign up")


async def _issue(
    response: Response,
    settings: Settings,
    session: AsyncSession,
    email: str,
    name: str | None = None,
    invitation_code: str | None = None,
) -> User:
    if await users.by_email(session, email) is None:
        _check_invitation(settings, invitation_code)
    user = await users.get_or_create(session, email, admin_emails=settings.admin_emails)
    if name and user.name is None:
        await users.update(session, user, name=name)
    _set_session_cookies(response, settings, user)
    return user


@router.post("/auth/google")
async def google_login(
    body: GoogleLogin, settings: SettingsDep, session: SessionDep, response: Response
) -> UserOut:
    """Exchange a Google ID token for the Lattice session cookies."""
    if not settings.google_client_id:
        raise HTTPException(501, "Google sign-in is not configured (GOOGLE_CLIENT_ID unset)")
    try:
        claims = google_id_token.verify_oauth2_token(
            body.credential, google_requests.Request(), settings.google_client_id
        )
    except ValueError as exc:
        raise HTTPException(401, f"invalid Google credential: {exc}") from exc
    if not claims.get("email_verified"):
        raise HTTPException(401, "the Google account's email is unverified")
    if settings.google_hosted_domain and claims.get("hd") != settings.google_hosted_domain:
        raise HTTPException(403, f"sign in with a {settings.google_hosted_domain} account")
    user = await _issue(
        response,
        settings,
        session,
        claims["email"].lower(),
        claims.get("name"),
        body.invitation_code,
    )
    return UserOut.model_validate(user)


@router.post("/auth/dev")
async def dev_login(
    body: DevLogin, settings: SettingsDep, session: SessionDep, response: Response
) -> UserOut:
    """A real session cookie without Google. Dev only; hidden when DEV_HEADER_AUTH is off."""
    if not settings.dev_header_auth:
        raise HTTPException(404)
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "an email is required")
    user = await _issue(response, settings, session, email, invitation_code=body.invitation_code)
    return UserOut.model_validate(user)


def _refresh_token(request: Request) -> str | None:
    token = request.cookies.get(REFRESH_COOKIE)
    if token is None:
        authorization = request.headers.get("authorization", "")
        if authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip() or None
    return token


@router.post("/auth/refresh")
async def refresh(
    request: Request, response: Response, settings: SettingsDep, session: SessionDep
) -> UserOut:
    """Trade a valid refresh token for a new access/refresh pair (rotation)."""
    token = _refresh_token(request)
    user_id = token and read_refresh_subject(settings, token)
    user = user_id and await users.by_id(session, user_id)
    if user is None:
        _clear_session_cookies(response)
        raise HTTPException(401, "session expired; sign in again")
    _set_session_cookies(response, settings, user)
    return UserOut.model_validate(user)


@router.post("/auth/logout")
async def logout(response: Response) -> dict[str, bool]:
    _clear_session_cookies(response)
    return {"ok": True}
