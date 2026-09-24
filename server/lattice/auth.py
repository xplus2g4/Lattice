"""The tokens the API trusts after login.

Two signed JWTs: a short-lived access token every call is verified against, and a
long-lived refresh token whose only job is minting new pairs at `/auth/refresh`.
Browsers carry both in HttpOnly cookies (the refresh cookie is scoped to `/auth`);
non-browser clients (the Go CLI from ADR 0004) send the access token as
`Authorization: Bearer` and may present the refresh token the same way.
Google is only involved at `/auth/google`; every other call verifies these tokens.

The `typ` claim keeps the two tokens in their lanes: a refresh token is not a
session, and an access token cannot mint anything.
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt

from lattice.config import Settings

ACCESS_COOKIE = "lattice_session"
REFRESH_COOKIE = "lattice_refresh"
# The refresh cookie only ever needs to reach the auth endpoints.
REFRESH_COOKIE_PATH = "/auth"

# Used only when SESSION_SECRET is unset: dev sessions reset on restart rather than
# trusting a default committed to the repo.
_EPHEMERAL_SECRET = secrets.token_hex(32)


def _secret(settings: Settings) -> str:
    return settings.session_secret or _EPHEMERAL_SECRET


def _issue(settings: Settings, typ: str, claims: dict, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"typ": typ, "iat": now, "exp": now + ttl, "jti": uuid4().hex, **claims},
        _secret(settings),
        algorithm="HS256",
    )


def issue_access(settings: Settings, user_id: UUID, email: str) -> str:
    return _issue(
        settings,
        "access",
        {"sub": str(user_id), "email": email},
        timedelta(minutes=settings.access_token_ttl_minutes),
    )


def issue_refresh(settings: Settings, user_id: UUID) -> str:
    return _issue(
        settings,
        "refresh",
        {"sub": str(user_id)},
        timedelta(days=settings.refresh_token_ttl_days),
    )


def _read(settings: Settings, token: str, typ: str) -> dict | None:
    """The claims of a valid token of the given type, else None."""
    try:
        claims = jwt.decode(token, _secret(settings), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return claims if claims.get("typ") == typ else None


def read_access_email(settings: Settings, token: str) -> str | None:
    """The email inside a valid access token, else None."""
    claims = _read(settings, token, "access")
    if claims is None:
        return None
    email = claims.get("email")
    return email if isinstance(email, str) else None


def read_refresh_subject(settings: Settings, token: str) -> UUID | None:
    """The user id inside a valid refresh token, else None."""
    claims = _read(settings, token, "refresh")
    if claims is None:
        return None
    try:
        return UUID(str(claims.get("sub")))
    except ValueError, AttributeError, TypeError:
        return None
