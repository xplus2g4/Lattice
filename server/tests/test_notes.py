"""Notes: quick capture, page-anchored upsert, privacy, and deletion."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from lattice.db.models import Job
from tests.test_materials import BOB, join, upload

pytestmark = pytest.mark.asyncio


async def material_id(client: AsyncClient) -> str:
    await join(client)
    return (await upload(client))["material"]["id"]


async def queued_indexings(session) -> list[Job]:
    return list(await session.scalars(select(Job).where(Job.kind == "index_note")))


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


async def test_saving_queues_private_indexing(student: AsyncClient, session) -> None:
    await join(student)
    note = await save(student, body_md="hash tables")

    jobs = await queued_indexings(session)
    assert [job.payload_json["note_id"] for job in jobs] == [note["id"]]


async def test_autosaving_the_same_note_queues_one_job(student: AsyncClient, session) -> None:
    """#38: five keystrokes' worth of autosave must not mean five cognify runs."""
    material = await material_id(student)

    for body in ("h", "ha", "has", "hash"):
        await save(student, body_md=body, material=material, page=3)

    jobs = await queued_indexings(session)
    assert len(jobs) == 1
    assert jobs[0].status == "pending"


async def test_opting_out_keeps_the_note_out_of_the_engine(student: AsyncClient, session) -> None:
    await join(student)
    await student.post("/me.update", json={"notes_opt_out": True})

    await save(student, body_md="private, and staying that way")
    assert await queued_indexings(session) == []


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
