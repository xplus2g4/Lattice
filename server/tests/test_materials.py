"""Material records: upload, deduplication, status, retry, deletion, and access control."""

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio

BOB = {"X-User": "bob@example.com"}


async def join(client: AsyncClient, code: str = "cs3216", **kwargs) -> None:
    await client.post(
        "/courses.create", json={"code": code, "name": "Software Engineering"}, **kwargs
    )
    await client.post("/enrolments.join", json={"course": code}, **kwargs)


def upload_args(content: bytes = b"week one slides", filename: str = "week1.pdf", course="cs3216"):
    return {"data": {"course": course}, "files": {"file": (filename, content, "application/pdf")}}


async def upload(client: AsyncClient, headers: dict | None = None, **kwargs) -> dict:
    response = await client.post("/materials.upload", headers=headers, **upload_args(**kwargs))
    assert response.status_code == 202, response.text
    return response.json()


async def test_upload_persists_a_queued_material(student: AsyncClient, ingest) -> None:
    await join(student)
    body = await upload(student)

    material = body["material"]
    assert body["deduplicated"] is False
    assert material["status"] == "queued"
    assert material["filename"] == "week1.pdf"
    assert material["sha256"]
    assert [str(queued) for queued in ingest.queued] == [material["id"]]


async def test_download_returns_only_the_enrolled_material_bytes(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student, content=b"course memo", filename="memo.txt"))["material"]
    downloaded = await student.get("/materials.download", params={"material": material["id"]})
    assert downloaded.status_code == 200
    assert downloaded.content == b"course memo"
    assert "memo.txt" in downloaded.headers["content-disposition"]


async def test_download_rejects_an_unenrolled_caller(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]
    response = await student.get(
        "/materials.download", params={"material": material["id"]}, headers=BOB
    )
    assert response.status_code == 403


async def test_material_survives_the_request(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]

    response = await student.get("/materials.get", params={"material": material["id"]})
    assert response.status_code == 200
    assert response.json()["id"] == material["id"]


async def test_same_bytes_join_the_existing_material(student: AsyncClient, ingest) -> None:
    """#34: the second upload of a file already in the course cognifies nothing."""
    await join(student)
    first = (await upload(student))["material"]

    body = await upload(student, filename="copy-of-week1.pdf")
    assert body["deduplicated"] is True
    assert body["material"]["id"] == first["id"]
    assert len(ingest.queued) == 1


async def test_same_bytes_in_another_course_are_a_separate_material(student: AsyncClient) -> None:
    await join(student, "cs3216")
    await join(student, "cs3217")
    first = (await upload(student))["material"]

    second = (await upload(student, course="cs3217"))["material"]
    assert second["id"] != first["id"]
    assert second["sha256"] == first["sha256"]


async def test_upload_rejects_unsupported_types(student: AsyncClient) -> None:
    await join(student)
    response = await student.post(
        "/materials.upload", **upload_args(filename="lecture.mp4", content=b"...")
    )
    assert response.status_code == 415


async def test_upload_requires_enrolment(student: AsyncClient) -> None:
    await join(student)

    response = await student.post("/materials.upload", headers=BOB, **upload_args())
    assert response.status_code == 403


async def test_list_is_scoped_to_the_course(student: AsyncClient) -> None:
    await join(student, "cs3216")
    await join(student, "cs3217")
    await upload(student)
    await upload(student, content=b"tutorial one", filename="t1.pdf", course="cs3217")

    response = await student.get("/materials.list", params={"course": "cs3216"})
    assert [m["filename"] for m in response.json()] == ["week1.pdf"]


async def test_outsiders_cannot_read_a_material(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]

    response = await student.get("/materials.get", params={"material": material["id"]}, headers=BOB)
    assert response.status_code == 403


async def test_metadata_update_is_the_uploaders(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]

    response = await student.post(
        "/materials.update",
        json={"material": material["id"], "week": 1, "kind": "slides", "title": "Week 1"},
    )
    assert response.status_code == 200
    assert response.json()["week"] == 1
    assert response.json()["kind"] == "slides"
    assert response.json()["title"] == "Week 1"


async def test_a_classmate_cannot_change_someone_elses_material(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    response = await student.post(
        "/materials.update", json={"material": material["id"], "week": 2}, headers=BOB
    )
    assert response.status_code == 403


async def test_retry_only_applies_to_a_failed_ingest(student: AsyncClient, session, ingest) -> None:
    """#35: the status is durable, and a stuck-looking queued material is not requeued."""
    from lattice.db.repo import materials

    await join(student)
    material = (await upload(student))["material"]

    queued = await student.post("/materials.retry", json={"material": material["id"]})
    assert queued.status_code == 409

    row = await materials.get(session, material["id"])
    await materials.set_status(session, row, "failed", "boom")
    await session.commit()

    assert (await student.get("/materials.get", params={"material": material["id"]})).json()[
        "error"
    ] == "boom"
    retried = await student.post("/materials.retry", json={"material": material["id"]})
    assert retried.status_code == 202
    assert retried.json()["status"] == "queued"
    assert retried.json()["error"] is None
    assert len(ingest.queued) == 2


async def test_delete_removes_the_material(student: AsyncClient) -> None:
    await join(student)
    material = (await upload(student))["material"]

    assert (await student.post("/materials.delete", json={"material": material["id"]})).json() == {
        "deleted": True
    }
    gone = await student.get("/materials.get", params={"material": material["id"]})
    assert gone.status_code == 404


async def test_the_course_owner_may_remove_a_classmates_upload(student: AsyncClient) -> None:
    await join(student)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)
    material = (await upload(student, headers=BOB))["material"]

    deleted = await student.post("/materials.delete", json={"material": material["id"]})
    assert deleted.status_code == 200


async def test_materials_need_an_identity(client: AsyncClient) -> None:
    assert (await client.get("/materials.list", params={"course": "cs3216"})).status_code == 401
