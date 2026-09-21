"""The caller's user record: created on first sight, reused afterwards, editable."""

from httpx import AsyncClient


async def test_first_request_creates_the_user(student: AsyncClient) -> None:
    body = (await student.get("/me.get")).json()
    assert body["user"]["email"] == "ada@example.com"
    assert body["user"]["role"] == "student"
    assert body["courses"] == []


async def test_second_request_reuses_the_same_user(student: AsyncClient) -> None:
    first = (await student.get("/me.get")).json()["user"]["id"]
    assert (await student.get("/me.get")).json()["user"]["id"] == first


async def test_identities_are_distinct_users(client: AsyncClient) -> None:
    ada = await client.get("/me.get", headers={"X-User": "ada@example.com"})
    bob = await client.get("/me.get", headers={"X-User": "bob@example.com"})
    assert ada.json()["user"]["id"] != bob.json()["user"]["id"]


async def test_email_is_matched_case_insensitively(client: AsyncClient) -> None:
    lower = await client.get("/me.get", headers={"X-User": "ada@example.com"})
    upper = await client.get("/me.get", headers={"X-User": "Ada@Example.com"})
    assert lower.json()["user"]["id"] == upper.json()["user"]["id"]


async def test_update_persists(student: AsyncClient) -> None:
    updated = (await student.post("/me.update", json={"name": "Ada", "notes_opt_out": True})).json()
    assert (updated["name"], updated["notes_opt_out"]) == ("Ada", True)
    assert (await student.get("/me.get")).json()["user"]["name"] == "Ada"


async def test_update_leaves_omitted_fields_alone(student: AsyncClient) -> None:
    await student.post("/me.update", json={"name": "Ada", "notes_opt_out": True})
    unchanged = (await student.post("/me.update", json={})).json()
    assert (unchanged["name"], unchanged["notes_opt_out"]) == ("Ada", True)


async def test_no_identity_is_rejected(client: AsyncClient) -> None:
    assert (await client.get("/me.get")).status_code == 401
