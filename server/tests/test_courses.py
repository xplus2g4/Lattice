"""Courses and enrolments: create-or-join (#34), search (#33), and who may see what."""

from httpx import AsyncClient, Response

from tests.test_materials import upload

BOB = {"X-User": "bob@example.com"}


async def create(
    client: AsyncClient, code: str = "cs3216", name: str = "Software Engineering", **extra
) -> Response:
    return await client.post("/courses.create", json={"code": code, "name": name, **extra})


async def join(client: AsyncClient, code: str = "cs3216", **kwargs) -> Response:
    return await client.post("/enrolments.join", json={"course": code}, **kwargs)


async def test_create_returns_the_course(student: AsyncClient) -> None:
    body = (await create(student, term="24/25 S1")).json()
    assert (body["code"], body["name"], body["term"]) == (
        "cs3216",
        "Software Engineering",
        "24/25 S1",
    )
    assert body["global_dataset_name"] == "cs3216-global"


async def test_course_survives_a_new_request(student: AsyncClient) -> None:
    created = (await create(student)).json()
    fetched = await student.get("/courses.get", params={"course": "cs3216"})
    assert fetched.json()["id"] == created["id"]


async def test_duplicate_code_returns_the_existing_course_to_join(student: AsyncClient) -> None:
    first = (await create(student)).json()
    clash = await create(student, name="Something else")
    assert clash.status_code == 409
    detail = clash.json()["detail"]
    assert detail["reason"] == "course_exists"
    assert detail["course"]["id"] == first["id"]


async def test_unknown_code_is_404(student: AsyncClient) -> None:
    assert (await student.get("/courses.get", params={"course": "cs9999"})).status_code == 404


async def test_malformed_code_is_rejected(student: AsyncClient) -> None:
    assert (await create(student, code="CS 3216")).status_code == 422


async def test_search_matches_exact_code_and_title_substring(student: AsyncClient) -> None:
    await create(student, code="cs3216", name="Software Engineering")
    await create(student, code="cs2103", name="Software Engineering II")
    by_code = (await student.get("/courses.search", params={"q": "cs3216"})).json()["results"]
    assert [hit["course"]["code"] for hit in by_code] == ["cs3216"]
    by_title = (await student.get("/courses.search", params={"q": "engineering"})).json()["results"]
    assert [hit["course"]["code"] for hit in by_title] == ["cs2103", "cs3216"]


async def test_search_reports_the_callers_enrolment(student: AsyncClient) -> None:
    await create(student)
    before = (await student.get("/courses.search", params={"q": "cs3216"})).json()["results"]
    assert before[0]["enrolled"] is False
    await join(student)
    after = (await student.get("/courses.search", params={"q": "cs3216"})).json()["results"]
    assert after[0]["enrolled"] is True


async def test_only_the_owner_may_update(student: AsyncClient) -> None:
    await create(student)
    renamed = await student.post("/courses.update", json={"course": "cs3216", "name": "Renamed"})
    assert renamed.status_code == 200
    intruder = await student.post(
        "/courses.update", json={"course": "cs3216", "name": "Hijacked"}, headers=BOB
    )
    assert intruder.status_code == 403
    current = await student.get("/courses.get", params={"course": "cs3216"})
    assert current.json()["name"] == "Renamed"


async def test_join_records_the_private_dataset(student: AsyncClient, engine) -> None:
    await create(student)
    enrolment = (await join(student)).json()
    assert enrolment["user_dataset_name"].startswith("cs3216-user-")
    assert engine.enrolled == [("cs3216", "ada@example.com")]


async def test_join_is_idempotent(student: AsyncClient) -> None:
    await create(student)
    first = (await join(student)).json()
    assert (await join(student)).json() == first
    assert len((await student.get("/courses.list")).json()) == 1


async def test_list_only_returns_courses_the_caller_joined(student: AsyncClient) -> None:
    await create(student, code="cs3216")
    await create(student, code="cs2103", name="Software Engineering II")
    await join(student)
    mine = (await student.get("/courses.list")).json()
    assert [course["code"] for course in mine] == ["cs3216"]
    assert (await student.get("/courses.list", headers=BOB)).json() == []


async def test_summary_counts_materials_notes_and_pending(student: AsyncClient) -> None:
    await create(student)
    await create(student, code="cs2103", name="Software Engineering II")
    await join(student)
    await join(student, code="cs2103")
    await upload(student)
    await student.post("/notes.save", json={"course": "cs3216", "body_md": "hash tables"})

    by_code = {s["code"]: s for s in (await student.get("/courses.summary")).json()}
    assert by_code["cs3216"]["material_count"] == 1
    assert by_code["cs3216"]["note_count"] == 1
    assert by_code["cs3216"]["pending_count"] == 1
    assert by_code["cs2103"]["material_count"] == 0
    assert by_code["cs2103"]["note_count"] == 0
    # Another student's notes do not count.
    assert (await student.get("/courses.summary", headers=BOB)).json() == []


async def test_leave_removes_the_enrolment_only(student: AsyncClient) -> None:
    await create(student)
    await join(student)
    left = await student.post("/enrolments.leave", json={"course": "cs3216"})
    assert left.json() == {"left": True}
    assert (await student.get("/courses.list")).json() == []
    again = await student.post("/enrolments.leave", json={"course": "cs3216"})
    assert again.json() == {"left": False}
    assert (await student.get("/courses.get", params={"course": "cs3216"})).status_code == 200


async def test_roster_lists_members_and_is_closed_to_outsiders(student: AsyncClient) -> None:
    await create(student)
    await join(student)
    await join(student, headers=BOB)
    roster = await student.get("/enrolments.list", params={"course": "cs3216"})
    assert [user["email"] for user in roster.json()] == ["ada@example.com", "bob@example.com"]
    outsider = await student.get(
        "/enrolments.list", params={"course": "cs3216"}, headers={"X-User": "eve@example.com"}
    )
    assert outsider.status_code == 403


async def test_every_endpoint_needs_an_identity(client: AsyncClient) -> None:
    assert (await client.get("/courses.list")).status_code == 401
    created = await client.post("/courses.create", json={"code": "cs3216", "name": "x"})
    assert created.status_code == 401
