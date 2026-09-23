"""The session token the API trusts after login.

A signed JWT naming the user. Browsers carry it in an HttpOnly cookie; non-browser
clients (the Go CLI from ADR 0004) carry the same token as `Authorization: Bearer`.
Google is only involved at `/auth/google`; every other call verifies this token.
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from lattice.config import Settings

SESSION_COOKIE = "lattice_session"

# Used only when SESSION_SECRET is unset: dev sessions reset on restart rather than
# trusting a default committed to the repo.
_EPHEMERAL_SECRET = secrets.token_hex(32)


def _secret(settings: Settings) -> str:
    return settings.session_secret or _EPHEMERAL_SECRET


def issue_session(settings: Settings, user_id: UUID, email: str) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "email": email,
            "iat": now,
            "exp": now + timedelta(hours=settings.session_ttl_hours),
        },
        _secret(settings),
        algorithm="HS256",
    )


def read_session_email(settings: Settings, token: str) -> str | None:
    """The email inside a valid session token, else None."""
    try:
        claims = jwt.decode(token, _secret(settings), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    email = claims.get("email")
    return email if isinstance(email, str) else None
