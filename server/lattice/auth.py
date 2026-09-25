"""Verification of the Bearer token the web app issues after Google sign-in.

The web app owns the OAuth handshake: it verifies Google's id_token once, keeps the
identity in its session cookie, and mints a Lattice token (HS256, shared `TOKEN_SECRET`)
that the API verifies locally on every call. An empty `token_secret` disables the Bearer
path entirely, which keeps dev-header-only setups working.
"""

import jwt

from lattice.config import Settings


class AuthError(Exception):
    """A missing, malformed or expired Bearer token; the API maps this to 401."""


def verify_token(settings: Settings, token: str) -> dict:
    """The claims of a web-issued token: `sub`, `email`, `name`. Raises `AuthError`."""
    if not settings.token_secret:
        raise AuthError("Bearer auth is not configured (TOKEN_SECRET is unset)")
    try:
        claims = jwt.decode(token, settings.token_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError(f"invalid token: {e}") from e
    if not isinstance(claims.get("email"), str) or "@" not in claims["email"]:
        raise AuthError("token has no email claim")
    return claims
