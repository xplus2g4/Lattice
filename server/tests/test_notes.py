"""Notes: quick capture, page-anchored upsert, privacy, and deletion."""

import pytest
from httpx import AsyncClient

from tests.test_materials import BOB, join, upload

pytestmark = pytest.mark.asyncio


async def test_rename_persists_without_changing_body_revision_or_cognify(student, ingest):
    await join(student)
    original = await save(student, body_md="Private study text")
    queued = list(ingest.notes)
    renamed = await student.post(
        "/notes.rename", json={"note": original["id"], "title": "Week 3 recap"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "Week 3 recap"
    for key in ("id", "body_md", "revision", "cognified_revision", "status"):
        assert renamed.json()[key] == original[key]
    assert ingest.notes == queued
    reloaded = await student.get("/notes.get", params={"note": original["id"]})
    assert reloaded.json()["title"] == "Week 3 recap"
    stolen = await student.post(
        "/notes.rename", headers=BOB, json={"note": original["id"], "title": "Stolen"}
    )
    assert stolen.status_code == 404
    await save(student, note=original["id"], body_md="Revised body", expected_revision=1)
    assert (await student.get("/notes.get", params={"note": original["id"]})).json()[
        "title"
    ] == "Week 3 recap"


async def material_id(client: AsyncClient) -> str:
    await join(client)
    return (await upload(client))["material"]["id"]


async def save(client: AsyncClient, headers: dict | None = None, **body) -> dict:
    response = await client.post("/notes.save", json={"course": "cs3216", **body}, headers=headers)
    assert response.status_code == 202, response.text
    return response.json()


async def test_a_quick_note_needs_no_material(student: AsyncClient) -> None:
    await join(student)

    note = await save(student, body_md="hash tables are week 3")
    assert note["material_id"] is None
    assert note["page"] is None
    assert note["status"] == "dirty"


async def test_a_saved_note_survives_the_request(student: AsyncClient) -> None:
    await join(student)
    note = await save(student, body_md="hash tables")

    fetched = await student.get("/notes.get", params={"note": note["id"]})
    assert fetched.json()["body_md"] == "hash tables"


async def test_saving_a_page_twice_edits_one_note(student: AsyncClient) -> None:
    """#38: autosave writes the same page over and over and must not pile up rows."""
    material = await material_id(student)

    first = await save(student, body_md="draft", material=material, page=4)
    second = await save(student, body_md="draft, revised", material=material, page=4)

    assert second["id"] == first["id"]
    assert second["body_md"] == "draft, revised"
    listed = await student.get("/notes.list", params={"course": "cs3216"})
    assert len(listed.json()) == 1


async def test_different_pages_are_different_notes(student: AsyncClient) -> None:
    material = await material_id(student)

    await save(student, body_md="page four", material=material, page=4)
    await save(student, body_md="page five", material=material, page=5)

    listed = await student.get("/notes.list", params={"course": "cs3216"})
    assert [n["page"] for n in listed.json()] == [4, 5]


async def test_the_reader_can_ask_for_an_unwritten_page(student: AsyncClient) -> None:
    material = await material_id(student)

    empty = await student.get("/notes.get", params={"material": material, "page": 9})
    assert empty.json() is None


async def test_a_page_needs_its_material(student: AsyncClient) -> None:
    await join(student)

    response = await student.post(
        "/notes.save", json={"course": "cs3216", "body_md": "orphan", "page": 3}
    )
    assert response.status_code == 422


async def test_notes_are_private_to_their_author(student: AsyncClient) -> None:
    """#39: a classmate sees neither the Note nor its existence."""
    material = await material_id(student)
    mine = await save(student, body_md="mine", material=material, page=2)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    stolen = await student.get("/notes.get", params={"note": mine["id"]}, headers=BOB)
    assert stolen.status_code == 404
    theirs = await student.get("/notes.list", params={"course": "cs3216"}, headers=BOB)
    assert theirs.json() == []


async def test_the_same_page_holds_one_note_per_student(student: AsyncClient) -> None:
    material = await material_id(student)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    mine = await save(student, body_md="mine", material=material, page=2)
    theirs = await save(student, body_md="theirs", material=material, page=2, headers=BOB)
    assert theirs["id"] != mine["id"]


async def test_saving_queues_indexing_into_the_private_tier(student: AsyncClient, ingest) -> None:
    await join(student)
    note = await save(student, body_md="hash tables")

    assert [str(queued) for queued in ingest.notes] == [note["id"]]


async def test_opting_out_keeps_the_note_out_of_the_engine(student: AsyncClient, ingest) -> None:
    await join(student)
    await student.post("/me.update", json={"notes_opt_out": True})

    await save(student, body_md="private, and staying that way")
    assert ingest.notes == []


async def test_notes_need_enrolment(student: AsyncClient) -> None:
    await join(student)

    response = await student.post(
        "/notes.save", json={"course": "cs3216", "body_md": "sneaky"}, headers=BOB
    )
    assert response.status_code == 403


async def test_delete_removes_the_note(student: AsyncClient) -> None:
    await join(student)
    note = await save(student, body_md="temporary")

    assert (await student.post("/notes.delete", json={"note": note["id"]})).json() == {
        "deleted": True
    }
    assert (await student.get("/notes.get", params={"note": note["id"]})).status_code == 404


async def test_notes_need_an_identity(client: AsyncClient) -> None:
    assert (await client.get("/notes.list", params={"course": "cs3216"})).status_code == 401
