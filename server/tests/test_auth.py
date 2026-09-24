"""Signing in: the token pair, the dev login, the Google exchange, invitations, and admin gating."""

import pytest
from httpx import AsyncClient

from lattice.api import auth as auth_api
from lattice.config import Settings
from tests.test_materials import BOB, join

pytestmark = pytest.mark.asyncio

ADMIN = {"X-User": "root@example.com"}
ADA = {"X-User": "ada@example.com"}


@pytest.fixture
def settings(tmp_path, migrated_database):
    return Settings(
        database_url=migrated_database,
        dev_header_auth=True,
        session_secret="test-secret-at-least-thirty-two-bytes",
        google_client_id="test-client-id",
        admin_emails=["root@example.com"],
        cognee_root=tmp_path / "cognee",
        uploads_dir=tmp_path / "uploads",
    )


async def test_dev_login_issues_a_session_cookie(client: AsyncClient) -> None:
    response = await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert response.status_code == 200
    # The cookie alone authenticates — no X-User header was ever sent.
    assert (await client.get("/me.get")).json()["user"]["email"] == "ada@example.com"


async def test_the_cookie_wins_over_the_header(client: AsyncClient) -> None:
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert (await client.get("/me.get", headers=BOB)).json()["user"]["email"] == "ada@example.com"


async def test_a_bogus_cookie_falls_back_to_the_header(client: AsyncClient) -> None:
    client.cookies.set("lattice_session", "not-a-token")
    assert (await client.get("/me.get", headers=BOB)).status_code == 200


async def test_a_bogus_cookie_alone_is_rejected(client: AsyncClient) -> None:
    client.cookies.set("lattice_session", "not-a-token")
    assert (await client.get("/me.get")).status_code == 401


async def test_the_token_also_works_as_a_bearer(client: AsyncClient) -> None:
    """The same signed token the cookie carries is what the CLI will send."""
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    token = client.cookies.get("lattice_session")
    client.cookies.clear()
    me = await client.get("/me.get", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["user"]["email"] == "ada@example.com"


async def test_logout_ends_the_session(client: AsyncClient) -> None:
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    await client.post("/auth/logout")
    assert (await client.get("/me.get")).status_code == 401
    # The refresh cookie is gone too, so the session cannot be resurrected.
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_login_issues_a_refresh_cookie(client: AsyncClient) -> None:
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert client.cookies.get("lattice_refresh") is not None


async def test_refresh_mints_a_new_access_cookie(client: AsyncClient) -> None:
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    client.cookies.delete("lattice_session")
    assert (await client.post("/auth/refresh")).status_code == 200
    assert (await client.get("/me.get")).json()["user"]["email"] == "ada@example.com"


async def test_refresh_rotates_the_refresh_cookie(client: AsyncClient) -> None:
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    before = client.cookies.get("lattice_refresh")
    assert (await client.post("/auth/refresh")).status_code == 200
    assert client.cookies.get("lattice_refresh") != before


async def test_refresh_without_a_token_is_401(client: AsyncClient) -> None:
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_the_refresh_token_is_not_a_session(client: AsyncClient) -> None:
    """The typ claim keeps it out of the access lane."""
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    refresh = client.cookies.get("lattice_refresh")
    client.cookies.delete("lattice_session")
    client.cookies.set("lattice_session", refresh)
    assert (await client.get("/me.get")).status_code == 401


async def test_the_access_token_cannot_refresh(client: AsyncClient) -> None:
    """…and the typ claim keeps it out of the refresh lane (Bearer, as a CLI sends)."""
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    access, refresh = (
        client.cookies.get("lattice_session"),
        client.cookies.get("lattice_refresh"),
    )
    client.cookies.clear()
    denied = await client.post("/auth/refresh", headers={"Authorization": f"Bearer {access}"})
    assert denied.status_code == 401
    renewed = await client.post("/auth/refresh", headers={"Authorization": f"Bearer {refresh}"})
    assert renewed.status_code == 200
    assert (await client.get("/me.get")).json()["user"]["email"] == "ada@example.com"


async def test_an_expired_access_token_is_401(client: AsyncClient, settings: Settings) -> None:
    settings.access_token_ttl_minutes = -1
    await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert (await client.get("/me.get")).status_code == 401


async def test_a_new_email_needs_the_invitation_code(
    client: AsyncClient, settings: Settings
) -> None:
    settings.invitation_code = "cs3216-2026"
    for body in (
        {"email": "ada@example.com"},
        {"email": "ada@example.com", "invitation_code": "wrong"},
    ):
        response = await client.post("/auth/dev", json=body)
        assert response.status_code == 403
        assert (await client.get("/me.get")).status_code == 401


async def test_the_invitation_code_is_only_asked_once(
    client: AsyncClient, settings: Settings
) -> None:
    settings.invitation_code = "cs3216-2026"
    joined = await client.post(
        "/auth/dev",
        json={"email": "ada@example.com", "invitation_code": "cs3216-2026"},
    )
    assert joined.status_code == 200
    client.cookies.clear()
    # The user exists now, so later logins need no code.
    again = await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert again.status_code == 200


async def test_google_signup_needs_the_code_too(
    client: AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.invitation_code = "cs3216-2026"
    monkeypatch.setattr(
        auth_api.google_id_token,
        "verify_oauth2_token",
        lambda c, r, a: {"email": "ada@example.com", "email_verified": True},
    )
    denied = await client.post("/auth/google", json={"credential": "google-jwt"})
    assert denied.status_code == 403
    joined = await client.post(
        "/auth/google",
        json={"credential": "google-jwt", "invitation_code": "cs3216-2026"},
    )
    assert joined.status_code == 200


async def test_dev_login_is_hidden_without_dev_auth(
    client: AsyncClient, settings: Settings
) -> None:
    settings.dev_header_auth = False
    response = await client.post("/auth/dev", json={"email": "ada@example.com"})
    assert response.status_code == 404


async def test_google_login_is_501_until_configured(
    client: AsyncClient, settings: Settings
) -> None:
    settings.google_client_id = ""
    response = await client.post("/auth/google", json={"credential": "google-jwt"})
    assert response.status_code == 501


async def test_google_login_exchanges_a_verified_token(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_verify(credential, request, audience):
        assert audience == "test-client-id"
        return {"email": "Ada@Example.com", "email_verified": True, "name": "Ada"}

    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", fake_verify)
    response = await client.post("/auth/google", json={"credential": "google-jwt"})
    assert response.status_code == 200
    assert response.json()["email"] == "ada@example.com"
    # The login also set the cookie, and Google supplied the name on first sight.
    me = (await client.get("/me.get")).json()["user"]
    assert (me["email"], me["name"]) == ("ada@example.com", "Ada")


async def test_google_login_rejects_an_unverified_email(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        auth_api.google_id_token,
        "verify_oauth2_token",
        lambda c, r, a: {"email": "ada@example.com", "email_verified": False},
    )
    response = await client.post("/auth/google", json={"credential": "google-jwt"})
    assert response.status_code == 401


async def test_google_login_can_be_limited_to_a_domain(
    client: AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.google_hosted_domain = "school.edu"
    monkeypatch.setattr(
        auth_api.google_id_token,
        "verify_oauth2_token",
        lambda c, r, a: {"email": "ada@gmail.com", "email_verified": True, "hd": "gmail.com"},
    )
    response = await client.post("/auth/google", json={"credential": "google-jwt"})
    assert response.status_code == 403


async def test_admin_emails_promote_on_first_sight(client: AsyncClient) -> None:
    assert (await client.get("/me.get", headers=ADMIN)).json()["user"]["role"] == "admin"


async def test_admin_endpoints_need_an_identity(client: AsyncClient) -> None:
    response = await client.get("/admin/sessions.list", params={"course": "cs3216"})
    assert response.status_code == 401


async def test_students_cannot_reach_admin_endpoints(student: AsyncClient) -> None:
    response = await student.get("/admin/sessions.list", params={"course": "cs3216"})
    assert response.status_code == 403


async def test_an_admin_reads_across_students(client: AsyncClient) -> None:
    await join(client, headers=BOB)
    await client.post("/enrolments.join", json={"course": "cs3216"}, headers=ADA)
    for headers, question in ((BOB, "bob asked"), (ADA, "ada asked")):
        asked = await client.post(
            "/ask", json={"course": "cs3216", "question": question}, headers=headers
        )
        assert asked.status_code == 200, asked.text

    listed = await client.get("/admin/sessions.list", params={"course": "cs3216"}, headers=ADMIN)
    assert listed.status_code == 200
    assert {s["user_email"] for s in listed.json()} == {"bob@example.com", "ada@example.com"}

    one = await client.get(
        "/admin/sessions.list",
        params={"course": "cs3216", "user": "bob@example.com"},
        headers=ADMIN,
    )
    assert {s["user_email"] for s in one.json()} == {"bob@example.com"}

    got = await client.get(
        "/admin/sessions.get", params={"session": one.json()[0]["id"]}, headers=ADMIN
    )
    assert got.json()["turns"][0]["content_json"]["text"] == "bob asked"
