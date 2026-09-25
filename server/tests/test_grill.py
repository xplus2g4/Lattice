"""Grill me: questions written from a page range, graded in one submit, remark from history."""

import pytest
from httpx import AsyncClient

from lattice.quiz import (
    Asked,
    Grade,
    Grill,
    Page,
    Remark,
    ShortGrades,
    WrittenQuestion,
    WrittenQuiz,
    page_text,
    plan_batches,
    questions_per_batch,
)
from tests.test_materials import BOB, join, upload

pytestmark = pytest.mark.asyncio


def pdf(pages: list[str]) -> bytes:
    """A minimal PDF with one line of Helvetica text per page, enough for pypdf to read."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # the page tree, filled once the kids are known
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    kids = []
    for text in pages:
        page_no = len(objects) + 1
        kids.append(f"{page_no} 0 R")
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % (page_no + 1)
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode()
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, obj)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def mcq(prompt: str = "What resolves a collision?", page: int = 1, **extra) -> WrittenQuestion:
    return WrittenQuestion(
        kind="mcq",
        prompt=prompt,
        options=["Chaining", "Sorting", "Hashing twice", "Deleting"],
        answer="Chaining",
        explanation="Chaining keeps colliding keys in one bucket.",
        page=page,
        **extra,
    )


def short(prompt: str = "Define a hash collision.", page: int = 1) -> WrittenQuestion:
    return WrittenQuestion(
        kind="short_answer",
        prompt=prompt,
        answer="Two keys hash to the same bucket.",
        explanation="A collision is two keys sharing a slot.",
        page=page,
    )


WRITTEN = WrittenQuiz(topic_label="Hash collisions", questions=[mcq(), short()])


async def material(client: AsyncClient, **kwargs) -> str:
    await join(client)
    return (await upload(client, **kwargs))["material"]["id"]


async def plan(client: AsyncClient, material_id: str, **kwargs) -> dict:
    body = {"course": "cs3216", "material": material_id}
    response = await client.post("/quizzes.generate", json=body, **kwargs)
    assert response.status_code == 201, response.text
    return response.json()


async def extend(client: AsyncClient, quiz_id: str, batch: int = 0, **kwargs) -> list[dict]:
    response = await client.post(
        "/quizzes.extend", json={"quiz": quiz_id, "batch": batch}, **kwargs
    )
    assert response.status_code == 200, response.text
    return response.json()


async def generate(client: AsyncClient, material_id: str, **kwargs) -> dict:
    """Plan, write every batch, and read the Quiz back whole."""
    planned = await plan(client, material_id, **kwargs)
    for batch in planned["batches"]:
        await extend(client, planned["quiz"]["id"], batch["index"], **kwargs)
    fetched = await client.get("/quizzes.get", params={"quiz": planned["quiz"]["id"]}, **kwargs)
    assert fetched.status_code == 200, fetched.text
    return fetched.json()


def answers(quiz: dict, *texts: str) -> list[dict]:
    return [
        {"question": question["id"], "answer_text": text}
        for question, text in zip(quiz["questions"], texts, strict=True)
    ]


async def grade(client: AsyncClient, quiz: dict, *texts: str, **kwargs) -> dict:
    response = await client.post(
        "/quizzes.grade", json={"quiz": quiz["id"], "answers": answers(quiz, *texts)}, **kwargs
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- page text -------------------------------------------------------------------------


async def test_page_text_reads_the_requested_pdf_pages(tmp_path) -> None:
    path = tmp_path / "deck.pdf"
    path.write_bytes(pdf(["Hashing basics", "Collisions", "Open addressing"]))

    pages = page_text(path, 2, 3)

    assert [(p.page, p.text.strip()) for p in pages] == [(2, "Collisions"), (3, "Open addressing")]


async def test_page_text_clamps_an_end_past_the_last_page(tmp_path) -> None:
    path = tmp_path / "deck.pdf"
    path.write_bytes(pdf(["One", "Two"]))

    assert [p.page for p in page_text(path, 1, 40)] == [1, 2]
    with pytest.raises(ValueError, match="has 2 pages"):
        page_text(path, 3, 4)


async def test_page_text_treats_markdown_as_one_page(tmp_path) -> None:
    path = tmp_path / "notes.md"
    path.write_text("# Hashing\n\nA collision is two keys in one bucket.")

    assert [p.page for p in page_text(path, 1, 5)] == [1]
    with pytest.raises(ValueError, match="1 page"):
        page_text(path, 2, 2)


# --- planning and writing ------------------------------------------------------------------


async def test_plan_batches_cover_every_page_once() -> None:
    assert plan_batches(1) == [(1, 1)]
    assert plan_batches(12) == [(1, 12)]
    assert plan_batches(13) == [(1, 7), (8, 13)]
    assert plan_batches(24) == [(1, 12), (13, 24)]
    assert plan_batches(100) == [
        (1, 13),
        (14, 26),
        (27, 39),
        (40, 52),
        (53, 65),
        (66, 78),
        (79, 91),
        (92, 100),
    ]
    assert questions_per_batch(1) == 10
    assert questions_per_batch(2) == 5
    assert questions_per_batch(8) == 2
    with pytest.raises(ValueError):
        plan_batches(0)


async def test_generate_plans_the_whole_material_without_questions(
    student: AsyncClient, engine
) -> None:
    material_id = await material(student, content=pdf([f"Page {n}" for n in range(1, 14)]))

    planned = await plan(student, material_id)

    quiz = planned["quiz"]
    assert quiz["kind"] == "grill"
    assert quiz["status"] == "open"
    assert quiz["questions"] == []
    assert quiz["scope_json"] == {
        "material_id": material_id,
        "page_start": 1,
        "page_end": 13,
        "topic_label": "week1.pdf",
        "batches": [[1, 7], [8, 13]],
    }
    assert planned["batches"] == [
        {"index": 0, "page_start": 1, "page_end": 7},
        {"index": 1, "page_start": 8, "page_end": 13},
    ]
    assert engine.generate_calls == []


async def test_extend_writes_one_batch_from_its_pages_and_withholds_the_key(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(
        topic_label="Hash collisions", questions=[mcq(page=9), short(page=13)]
    )
    material_id = await material(student, content=pdf([f"Page {n}" for n in range(1, 14)]))
    planned = await plan(student, material_id)

    written = await extend(student, planned["quiz"]["id"], 1)

    assert [(q["position"], q["expected_json"]) for q in written] == [(100, None), (101, None)]
    assert written[0]["options_json"] == ["Chaining", "Sorting", "Hashing twice", "Deleting"]
    assert written[0]["citation_json"] == {"page": 9, "topic": "Hash collisions"}
    assert [q["material_id"] for q in written] == [material_id, material_id]
    schema, _, data = engine.generate_calls[0]
    assert schema is WrittenQuiz
    assert data["questions_wanted"] == 5
    assert [p["page"] for p in data["pages"]] == [8, 9, 10, 11, 12, 13]
    assert data["pages"][1]["text"].strip() == "Page 9"

    fetched = await student.get("/quizzes.get", params={"quiz": planned["quiz"]["id"]})
    assert [q["expected_json"] for q in fetched.json()["questions"]] == [None, None]


async def test_batches_keep_page_order_whatever_lands_first(student: AsyncClient, engine) -> None:
    material_id = await material(student, content=pdf([f"Page {n}" for n in range(1, 25)]))
    planned = await plan(student, material_id)
    quiz_id = planned["quiz"]["id"]
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Late", questions=[short(page=20)])
    await extend(student, quiz_id, 1)
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Early", questions=[short(page=2)])
    await extend(student, quiz_id, 0)

    fetched = await student.get("/quizzes.get", params={"quiz": quiz_id})

    assert [(q["position"], q["citation_json"]["topic"]) for q in fetched.json()["questions"]] == [
        (0, "Early"),
        (100, "Late"),
    ]


async def test_extending_the_same_batch_twice_returns_the_first_writing(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WRITTEN
    material_id = await material(student, content=b"text", filename="w1.md")
    planned = await plan(student, material_id)

    first = await extend(student, planned["quiz"]["id"], 0)
    second = await extend(student, planned["quiz"]["id"], 0)

    assert [q["id"] for q in second] == [q["id"] for q in first]
    assert len(engine.generate_calls) == 1


async def test_extend_refuses_a_batch_off_the_plan(student: AsyncClient, engine) -> None:
    material_id = await material(student, content=b"text", filename="w1.md")
    planned = await plan(student, material_id)

    response = await student.post(
        "/quizzes.extend", json={"quiz": planned["quiz"]["id"], "batch": 1}
    )

    assert response.status_code == 422
    assert engine.generate_calls == []


async def test_generate_drops_what_the_schema_cannot_vouch_for(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(
        topic_label="  Hash   collisions  ",
        questions=[
            mcq(prompt="answer not among the options").model_copy(update={"answer": "Nope"}),
            short(prompt="off the page", page=7),
            short(prompt="   "),
            mcq(prompt="duplicate options").model_copy(
                update={"options": ["Chaining", "Chaining", " ", "Sorting"], "answer": "Chaining"}
            ),
            short(prompt="kept"),
        ],
    )
    material_id = await material(student, content=b"text", filename="w1.md")

    quiz = await generate(student, material_id)

    assert [(q["prompt"], q["options_json"]) for q in quiz["questions"]] == [
        ("duplicate options", ["Chaining", "Sorting"]),
        ("kept", None),
    ]
    assert quiz["questions"][0]["citation_json"]["topic"] == "Hash collisions"


async def test_questions_about_the_deck_itself_are_dropped_and_numbering_stripped(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(
        topic_label="Clocks",
        questions=[
            short(prompt="1. Which lecture of CS4231 do these pages belong to?"),
            short(prompt="2) What is the stated goal of today's lecture?"),
            mcq(prompt="Question 3: Which chapter does the roadmap cover?"),
            short(
                prompt="4.  Why can a vector clock detect concurrency when a Lamport clock cannot?"
            ),
            mcq(prompt="Q5 - What happens to causal order if a channel reorders messages?"),
        ],
    )
    material_id = await material(student, content=b"text", filename="w1.md")

    quiz = await generate(student, material_id)

    assert [q["prompt"] for q in quiz["questions"]] == [
        "Why can a vector clock detect concurrency when a Lamport clock cannot?",
        "What happens to causal order if a channel reorders messages?",
    ]


async def test_generate_retries_once_then_reports_502(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="x", questions=[])
    material_id = await material(student, content=b"text", filename="w1.md")
    planned = await plan(student, material_id)

    response = await student.post(
        "/quizzes.extend", json={"quiz": planned["quiz"]["id"], "batch": 0}
    )

    assert response.status_code == 502
    assert len(engine.generate_calls) == 2
    fetched = await student.get("/quizzes.get", params={"quiz": planned["quiz"]["id"]})
    assert fetched.json()["questions"] == []


async def test_generate_needs_the_material_in_the_caller_s_course(
    student: AsyncClient, engine
) -> None:
    material_id = await material(student, content=b"text", filename="w1.md")
    await join(student, "cs3217")

    body = {"course": "cs3217", "material": material_id}
    assert (await student.post("/quizzes.generate", json=body)).status_code == 404
    body["course"] = "cs3216"
    assert (await student.post("/quizzes.generate", json=body, headers=BOB)).status_code == 403


# --- grading --------------------------------------------------------------------------


async def test_mcq_is_graded_in_code_and_the_key_is_then_shown(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(
        topic_label="Hashing", questions=[mcq(), mcq(prompt="Second?")]
    )
    engine.generated[Remark] = Remark(text="Re-read page 1 on hash collisions.")
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)

    result = await grade(student, quiz, " chaining ", "Sorting")

    graded = result["quiz"]
    assert graded["status"] == "submitted"
    assert graded["score"] == 0.5
    assert graded["submitted_at"] is not None
    first, second = graded["questions"]
    assert first["expected_json"] == {
        "answer": "Chaining",
        "explanation": "Chaining keeps colliding keys in one bucket.",
    }
    assert [(a["answer_text"], a["correct"]) for a in first["answers"]] == [(" chaining ", True)]
    assert second["answers"][0]["correct"] is False
    assert second["answers"][0]["feedback_json"] == {"reason": "The correct option is: Chaining"}
    assert result["remark"] == "Re-read page 1 on hash collisions."
    assert [schema for schema, _, _ in engine.generate_calls] == [WrittenQuiz, Remark]


async def test_short_answers_go_to_the_model_in_one_call(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(
        topic_label="Hashing",
        questions=[short(), mcq(), short(prompt="Why chain?"), short(prompt="Left ungraded")],
    )
    engine.generated[Remark] = Remark(text="")

    def grader(data: dict) -> ShortGrades:
        assert [item["position"] for item in data["items"]] == [0, 2, 3]
        assert data["items"][0] == {
            "position": 0,
            "prompt": "Define a hash collision.",
            "model_answer": "Two keys hash to the same bucket.",
            "student_answer": "same bucket, two keys",
        }
        return ShortGrades(
            grades=[
                Grade(position=0, correct=True, reason="That is the idea."),
                Grade(position=2, correct=False, reason="Chaining is about buckets, not speed."),
                Grade(position=9, correct=True, reason="not one of ours"),
            ]
        )

    engine.generated[ShortGrades] = grader
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)

    result = await grade(student, quiz, "same bucket, two keys", "Chaining", "speed", "hmm")

    verdicts = [
        (q["answers"][0]["correct"], q["answers"][0]["feedback_json"]["reason"])
        for q in result["quiz"]["questions"]
    ]
    assert verdicts == [
        (True, "That is the idea."),
        (True, "Correct."),
        (False, "Chaining is about buckets, not speed."),
        (None, "Not graded."),
    ]
    assert result["quiz"]["score"] == 0.5
    assert [schema for schema, _, _ in engine.generate_calls] == [WrittenQuiz, ShortGrades, Remark]


async def test_an_empty_answer_is_wrong_without_asking_the_model(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[short()])
    engine.generated[Remark] = Remark(text="")
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)

    result = await grade(student, quiz, "   ")

    answer = result["quiz"]["questions"][0]["answers"][0]
    assert (answer["correct"], answer["feedback_json"]) == (False, {"reason": "No answer given."})
    assert ShortGrades not in [schema for schema, _, _ in engine.generate_calls]


async def test_the_remark_reads_the_history_including_this_quiz(
    student: AsyncClient, engine
) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[mcq(page=1)])
    material_id = await material(student, content=b"text", filename="w1.md")
    earlier = await generate(student, material_id)
    engine.generated[Remark] = Remark(text="first")
    await grade(student, earlier, "Sorting")

    seen: list[dict] = []

    def remark(data: dict) -> Remark:
        seen.append(data)
        return Remark(text="  Re-read   page 1.  ")

    engine.generated[Remark] = remark
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Chaining", questions=[mcq(page=1)])
    later = await generate(student, material_id)

    result = await grade(student, later, "Chaining")

    assert result["remark"] == "Re-read page 1."
    rows = seen[0]["history"]
    assert [(row["topic_label"], row["page"], row["correct"]) for row in rows] == [
        ("Chaining", 1, True),
        ("Hashing", 1, False),
    ]
    assert rows[0]["prompt"] == "What resolves a collision?"
    assert "when" in rows[0]


async def test_a_failed_remark_does_not_fail_the_submit(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[mcq()])

    def broken(data: dict) -> Remark:
        raise RuntimeError("model down")

    engine.generated[Remark] = broken
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)

    result = await grade(student, quiz, "Chaining")

    assert result["remark"] == ""
    assert result["quiz"]["status"] == "submitted"


async def test_a_quiz_with_no_questions_yet_cannot_be_graded(student: AsyncClient) -> None:
    material_id = await material(student, content=b"text", filename="w1.md")
    planned = await plan(student, material_id)

    response = await student.post(
        "/quizzes.grade",
        json={
            "quiz": planned["quiz"]["id"],
            "answers": [{"question": planned["quiz"]["id"], "answer_text": "x"}],
        },
    )
    assert response.status_code == 422


async def test_grading_needs_every_question_and_only_those(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[mcq(), mcq()])
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)
    first, second = quiz["questions"]

    partial = {"quiz": quiz["id"], "answers": [{"question": first["id"], "answer_text": "x"}]}
    assert (await student.post("/quizzes.grade", json=partial)).status_code == 422
    foreign = {
        "quiz": quiz["id"],
        "answers": [
            {"question": first["id"], "answer_text": "x"},
            {"question": "00000000-0000-4000-8000-000000000000", "answer_text": "x"},
        ],
    }
    assert (await student.post("/quizzes.grade", json=foreign)).status_code == 422
    assert (await student.get("/quizzes.get", params={"quiz": quiz["id"]})).json()[
        "status"
    ] == "open"
    assert second["answers"] == []


async def test_a_graded_quiz_is_not_graded_twice(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[mcq()])
    engine.generated[Remark] = Remark(text="")
    material_id = await material(student, content=b"text", filename="w1.md")
    quiz = await generate(student, material_id)
    await grade(student, quiz, "Chaining")

    response = await student.post(
        "/quizzes.grade", json={"quiz": quiz["id"], "answers": answers(quiz, "Chaining")}
    )
    assert response.status_code == 409


async def test_someone_else_s_quiz_is_not_theirs_to_grade(student: AsyncClient, engine) -> None:
    engine.generated[WrittenQuiz] = WrittenQuiz(topic_label="Hashing", questions=[mcq()])
    material_id = await material(student, content=b"text", filename="w1.md")
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)
    quiz = await generate(student, material_id)

    response = await student.post(
        "/quizzes.grade",
        json={"quiz": quiz["id"], "answers": answers(quiz, "Chaining")},
        headers=BOB,
    )
    assert response.status_code == 404


# --- the module on its own ----------------------------------------------------------------


async def test_grill_grade_keeps_question_order() -> None:
    async def generate(schema, prompt, data):
        return ShortGrades(grades=[Grade(position=1, correct=True, reason="ok")])

    grades = await Grill(generate).grade(
        [
            Asked(position=0, kind="mcq", prompt="a", answer="A"),
            Asked(position=1, kind="short_answer", prompt="b", answer="B"),
        ],
        {0: "a", 1: "b-ish"},
    )

    assert [(g.position, g.correct) for g in grades] == [(0, True), (1, True)]


async def test_grill_write_needs_a_page() -> None:
    async def generate(schema, prompt, data):
        raise AssertionError("never called")

    with pytest.raises(ValueError):
        await Grill(generate).write([])


async def test_grill_write_labels_an_unlabelled_quiz_by_its_pages() -> None:
    async def generate(schema, prompt, data):
        return WrittenQuiz(topic_label="", questions=[mcq(page=4)])

    written = await Grill(generate).write([Page(page=3, text="x"), Page(page=4, text="y")])

    assert written.topic_label == "Pages 3-4"
