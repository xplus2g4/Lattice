"""Topic segmentation results (#41) and per-student reading positions (#29)."""

import pytest
from httpx import AsyncClient

from tests.test_materials import BOB, join, upload

pytestmark = pytest.mark.asyncio

TOPICS = [
    {"label": "Scaling", "page_start": 1, "page_end": 4},
    {"label": "Caching", "page_start": 5, "page_end": 9},
]


async def material_id(client: AsyncClient) -> str:
    await join(client)
    return (await upload(client))["material"]["id"]


async def test_topics_are_stored_in_order(student: AsyncClient) -> None:
    material = await material_id(student)

    response = await student.post("/topics.replace", json={"material": material, "topics": TOPICS})
    assert response.status_code == 200
    assert [(t["label"], t["position"]) for t in response.json()] == [
        ("Scaling", 0),
        ("Caching", 1),
    ]

    listed = await student.get("/topics.list", params={"material": material})
    assert [t["label"] for t in listed.json()] == ["Scaling", "Caching"]


async def test_resegmenting_replaces_the_previous_run(student: AsyncClient) -> None:
    material = await material_id(student)
    await student.post("/topics.replace", json={"material": material, "topics": TOPICS})

    await student.post(
        "/topics.replace",
        json={
            "material": material,
            "topics": [{"label": "Everything", "page_start": 1, "page_end": 9}],
        },
    )
    listed = await student.get("/topics.list", params={"material": material})
    assert [t["label"] for t in listed.json()] == ["Everything"]


async def test_a_topic_cannot_end_before_it_starts(student: AsyncClient) -> None:
    material = await material_id(student)

    response = await student.post(
        "/topics.replace",
        json={"material": material, "topics": [{"label": "Back", "page_start": 9, "page_end": 2}]},
    )
    assert response.status_code == 422


async def test_reading_position_is_remembered_per_student(student: AsyncClient) -> None:
    material = await material_id(student)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    await student.post("/readingPosition.set", json={"material": material, "page": 7})
    await student.post("/readingPosition.set", json={"material": material, "page": 2}, headers=BOB)

    mine = await student.get("/readingPosition.get", params={"material": material})
    theirs = await student.get("/readingPosition.get", params={"material": material}, headers=BOB)
    assert (mine.json()["page"], theirs.json()["page"]) == (7, 2)


async def test_moving_on_overwrites_the_position(student: AsyncClient) -> None:
    material = await material_id(student)

    await student.post("/readingPosition.set", json={"material": material, "page": 3})
    await student.post("/readingPosition.set", json={"material": material, "page": 4})

    assert (await student.get("/readingPosition.get", params={"material": material})).json()[
        "page"
    ] == 4


async def test_unread_material_has_no_position(student: AsyncClient) -> None:
    material = await material_id(student)

    assert (await student.get("/readingPosition.get", params={"material": material})).json() is None
