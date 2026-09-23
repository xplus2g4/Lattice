"""Signing in: the Google OAuth exchange, a dev-only login, and sign-out.

Both logins end the same way: a `users` row (created on first sight) and the
session cookie. Everything after that is `deps.current_email` reading the cookie.
"""

from fastapi import APIRouter, HTTPException, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import SessionDep, SettingsDep
from lattice.api.schemas import UserOut
from lattice.auth import SESSION_COOKIE, issue_session
from lattice.config import Settings
from lattice.db.models import User
from lattice.db.repo import users

router = APIRouter(tags=["auth"])


class GoogleLogin(BaseModel):
    credential: str


class DevLogin(BaseModel):
    email: str


def _set_session_cookie(response: Response, settings: Settings, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        issue_session(settings, user.id, user.email),
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        # localhost counts as same-site across ports and as a secure context, so dev
        # needs no SameSite=None dance; deploys are HTTPS-only anyway.
        secure=not settings.dev_header_auth,
    )


async def _issue(
    response: Response,
    settings: Settings,
    session: AsyncSession,
    email: str,
    name: str | None = None,
) -> User:
    user = await users.get_or_create(
        session, email, admin_emails=settings.admin_emails
    )
    if name and user.name is None:
        await users.update(session, user, name=name)
    _set_session_cookie(response, settings, user)
    return user


@router.post("/auth/google")
async def google_login(
    body: GoogleLogin, settings: SettingsDep, session: SessionDep, response: Response
) -> UserOut:
    """Exchange a Google ID token for the Lattice session cookie."""
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
        response, settings, session, claims["email"].lower(), claims.get("name")
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
    user = await _issue(response, settings, session, email)
    return UserOut.model_validate(user)


@router.post("/auth/logout")
async def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}
