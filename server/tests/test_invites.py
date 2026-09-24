"""Bearer auth and the invite gate: closed signup's server half."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient

from lattice.auth import AuthError, verify_token
from lattice.config import Settings
from lattice.db.repo import invites

SECRET = "test-secret"


@pytest.fixture
def settings(tmp_path, migrated_database: str) -> Settings:
    return Settings(
        _env_file=None,
        database_url=migrated_database,
        dev_header_auth=True,
        token_secret=SECRET,
        mcp_enabled=False,
        database_auto_migrate=False,
        cognee_root=tmp_path / "cognee",
        uploads_dir=tmp_path / "uploads",
        instructor_email="prof@example.com",
        dev_invite_code="123456",
    )


def bearer(email: str, *, secret: str = SECRET, expires_in: int = 3600) -> dict:
    token = jwt.encode(
        {
            "sub": f"g|{email}",
            "email": email,
            "exp": datetime.now(UTC) + timedelta(seconds=expires_in),
        },
        secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


async def mint(client: AsyncClient, **kwargs) -> str:
    """An instructor-signed-in client mints one invite and returns its raw token."""
    r = await client.post("/invites.create", json=kwargs, headers=bearer("prof@example.com"))
    assert r.status_code == 201, r.text
    return r.json()["token"]


def test_verify_token_requires_secret() -> None:
    with pytest.raises(AuthError):
        verify_token(Settings(_env_file=None), "anything")


def test_verify_token_requires_email() -> None:
    settings = Settings(_env_file=None, token_secret=SECRET)
    token = jwt.encode({"sub": "g|x", "exp": datetime.now(UTC) + timedelta(hours=1)}, SECRET)
    with pytest.raises(AuthError):
        verify_token(settings, token)


async def test_header_auth_still_works(client: AsyncClient) -> None:
    r = await client.get("/me.get", headers={"X-User": "ada@example.com"})
    assert r.status_code == 200


async def test_bearer_stranger_needs_invite(client: AsyncClient) -> None:
    r = await client.get("/me.get", headers=bearer("new@example.com"))
    assert r.status_code == 403


async def test_instructor_bootstraps_as_instructor(client: AsyncClient) -> None:
    r = await client.get("/me.get", headers=bearer("prof@example.com"))
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "instructor"


async def test_bad_tokens_rejected(client: AsyncClient) -> None:
    for headers in (
        bearer("a@b.com", secret="wrong"),
        {"Authorization": "Bearer garbage"},
        {"Authorization": "Token abc"},
        bearer("a@b.com", expires_in=-10),
    ):
        r = await client.get("/me.get", headers=headers)
        assert r.status_code == 401, headers


async def test_invite_lifecycle(client: AsyncClient) -> None:
    token = await mint(client)

    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("new@example.com")
    )
    assert r.status_code == 200
    assert r.json()["email"] == "new@example.com"
    assert r.json()["role"] == "student"

    r = await client.get("/me.get", headers=bearer("new@example.com"))
    assert r.status_code == 200

    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("other@example.com")
    )
    assert r.status_code == 403


async def test_redeem_by_existing_user_keeps_invite(client: AsyncClient) -> None:
    token = await mint(client)
    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("prof@example.com")
    )
    assert r.status_code == 200
    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("fresh@example.com")
    )
    assert r.status_code == 200


async def test_invite_role_carries_to_new_user(client: AsyncClient) -> None:
    token = await mint(client, role="instructor")
    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("ta@example.com")
    )
    assert r.json()["role"] == "instructor"


async def test_students_cannot_create_invites(client: AsyncClient) -> None:
    token = await mint(client)
    await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("kid@example.com")
    )
    r = await client.post("/invites.create", json={}, headers=bearer("kid@example.com"))
    assert r.status_code == 403


async def test_expired_invite_rejected(client: AsyncClient, session) -> None:
    invite, token = await invites.create(
        session, role="student", ttl=timedelta(days=-1), created_by=None
    )
    assert invite.expires_at < datetime.now(UTC)
    r = await client.post(
        "/invites.redeem", json={"token": token}, headers=bearer("late@example.com")
    )
    assert r.status_code == 403


async def test_invite_via_header(client: AsyncClient) -> None:
    """Dev-header callers can redeem too, so the flow is testable without minting JWTs."""
    token = await mint(client)
    r = await client.post(
        "/invites.redeem", json={"token": token}, headers={"X-User": "dev@example.com"}
    )
    assert r.status_code == 200


async def test_dev_invite_code_admits_students(client: AsyncClient) -> None:
    """The fixed dev code is reusable and creates students, no invite row needed."""
    for email in ("one@example.com", "two@example.com"):
        r = await client.post(
            "/invites.redeem", json={"token": "123456"}, headers=bearer(email)
        )
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "student"

    r = await client.post(
        "/invites.redeem", json={"token": "654321"}, headers=bearer("bad@example.com")
    )
    assert r.status_code == 403
