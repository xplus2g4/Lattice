"""Evaluate `/ask` on a curated question set: retrieval hit rates with page numbers, and
answer quality judged by a second-family LLM.

Runs in-process, the way `tests/test_study_evaluation.py` does, because the chunk-size sweep
needs `Engine.replace(chunk_size=)` and a second process on the API's Cognee root is not
allowed. It takes the API's `note-ingest.lock`, so it refuses to start while the API is up.
Asks go through `study.ask_course`, the function `/ask` calls.

    uv run python eval/eval_course.py estimate                      # whole matrix, no calls
    uv run python eval/eval_course.py ask --chunk-size 8191
    uv run python eval/eval_course.py judge --run eval/CS4223/runs/<file>.json
    uv run python eval/eval_course.py report                        # every judged run
    uv run python eval/eval_course.py sample --run <file> --n 30    # hand-grading sheet
    uv run python eval/eval_course.py kappa --sheet <sheet.json>    # judge vs human

The decks are the course's seed PDFs (`data/seed/<COURSE>`, or `--source`), the same bytes
the product ingests; only decks that have questions are used. `ask` only runs questions
marked `"reviewed": true`, refuses when the estimate exceeds `--ceiling`, and writes one JSON
record per (chunk size, label) under `runs/`.
Course codes are `<course>c<chunk>` (`cs4223c8191`): the API's course-code pattern
allows no punctuation. The judge is `EVAL_JUDGE_MODEL` / `EVAL_JUDGE_API_KEY` from `.env`,
called through litellm with a JSON schema; sampling is the model's default, so the run-to-run
repeat covers judge noise as well as answer noise.
"""

import argparse
import asyncio
import hashlib
import json
import logging
import math
import os
import random
import shutil
import statistics
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))
sys.path.insert(0, str(SERVER_ROOT / "scripts"))  # seed_course pricing constants

from seed_course import INPUT_USD_PER_MTOK, OUTPUT_USD_PER_MTOK, PRICING  # noqa: E402

QUERY_TYPES = ("GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION")
# 8,191 is Cognee's default and what the product ingests at; 2,048 is the smaller size that
# tests whether tighter Chunks buy citation precision. With the OpenAI embedding model whole
# Chunks are embedded at either size.
CHUNK_SIZES = (2048, 8191)
TOP_K = 15  # Cognee's search default; `Engine.search` passes none
TERMINAL = {"ready", "failed"}
# What one completion costs in tokens beyond retrieved context, and what GRAPH's triplet
# context measured at (docs/research/cognee-1.5.4-first-cut-findings.md).
PROMPT_OVERHEAD_TOKENS = 600
ANSWER_TOKENS = 300
GRAPH_CONTEXT_TOKENS = 2_000
CHARS_PER_TOKEN = 4

JUDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "abstained": {"type": "boolean"},
        "correctness": {"type": "integer", "minimum": 0, "maximum": 2},
        "completeness": {"type": "integer", "minimum": 0, "maximum": 2},
        "faithfulness": {"type": ["integer", "null"], "minimum": 0, "maximum": 2},
        "key_facts_present": {"type": "array", "items": {"type": "boolean"}},
        "rationale": {"type": "string"},
    },
    "required": [
        "abstained",
        "correctness",
        "completeness",
        "faithfulness",
        "key_facts_present",
        "rationale",
    ],
}

JUDGE_SYSTEM = """You grade an answer given by a course question-answering system.

The REFERENCE ANSWER and KEY FACTS are authoritative for this course: grade only against
them, never against what you believe to be true.

Scores:
- correctness: 2 = every claim agrees with the reference; 1 = mostly agrees with a minor
  error; 0 = wrong, contradicts the reference, or answers a different question.
- completeness: 2 = all key facts present; 1 = at least half; 0 = fewer than half.
- faithfulness: judged ONLY against CITED TEXT. 2 = every claim is supported by it; 1 = mostly
  supported; 0 = contains claims the cited text does not support. If CITED TEXT is empty,
  return null.
- key_facts_present: one boolean per key fact, in order, true when the answer states it.
- abstained: true if the answer says the materials do not cover the question or it cannot
  answer from them, instead of answering.

For a question marked UNANSWERABLE the correct behaviour is to abstain: abstained=true gives
correctness 2 and completeness 2; a confident answer gives 0 and 0.
Return JSON only."""


# Dataset


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def course_code(course: str, chunk_size: int) -> str:
    return f"{course.lower()}c{chunk_size}"


@dataclass(frozen=True)
class Dataset:
    course: str
    root: Path
    questions: list[dict]
    decks: dict[str, Path]  # tag -> seed PDF

    @classmethod
    def load(cls, course: str, source: Path | None = None) -> Dataset:
        root = Path(__file__).resolve().parent / course
        questions = load_json(root / "questions.json")["questions"]
        asked = {g["deck"] for q in questions for g in q["gold_pages"]}
        source = source or SERVER_ROOT / "data" / "seed" / course.upper()
        decks = {
            tag: p
            for p in sorted(source.glob("*.pdf"))
            if (tag := p.stem.split(" ", 1)[0]) in asked
        }
        if missing := asked - decks.keys():
            sys.exit(f"decks {sorted(missing)} have questions but no PDF under {source}")
        return cls(course, root, questions, decks)

    def reviewed(self) -> list[dict]:
        return [q for q in self.questions if q.get("reviewed")]

    def page_text(self, tag: str, page: int) -> str:
        from pypdf import PdfReader

        path = self.decks[tag]
        cache = _PAGE_CACHE.setdefault(
            path, [p.extract_text() or "" for p in PdfReader(str(path)).pages]
        )
        return cache[page - 1] if 1 <= page <= len(cache) else ""


_PAGE_CACHE: dict[Path, list[str]] = {}


# Estimate


def deck_tokens(dataset: Dataset) -> dict[str, int]:
    from pypdf import PdfReader

    out = {}
    for tag, path in dataset.decks.items():
        pages = PdfReader(str(path)).pages
        out[tag] = sum(len(p.extract_text() or "") for p in pages) // CHARS_PER_TOKEN
    return out


def estimate_ask_usd(dataset: Dataset, chunk_size: int, query_types: list[str], n: int) -> dict:
    tokens = deck_tokens(dataset)
    chunks = sum(max(1, math.ceil(t / chunk_size)) for t in tokens.values())
    context = min(TOP_K, chunks) * min(chunk_size, max(tokens.values()))
    per_type = {
        "GRAPH_COMPLETION": GRAPH_CONTEXT_TOKENS,
        "RAG_COMPLETION": context,
        "HYBRID_COMPLETION": context + GRAPH_CONTEXT_TOKENS,
    }
    tokens_in = sum(n * (per_type[t] + PROMPT_OVERHEAD_TOKENS) for t in query_types)
    tokens_out = n * len(query_types) * ANSWER_TOKENS
    usd = tokens_in / 1e6 * INPUT_USD_PER_MTOK + tokens_out / 1e6 * OUTPUT_USD_PER_MTOK
    return {
        "asks": n * len(query_types),
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "usd": usd,
        "chunks": chunks,
    }


# Cognify cost fitted to two measured decks at peak DeepSeek rates: a 6,000-token deck in 2
# chunks (17,444 in / 43,600 out; docs/research/2026-09-20-cognee-material-provenance-cost.md)
# and a 1,715-token deck in 5 chunks at chunk_size=512 (16,000 in / 88,767 out; harness smoke,
# 23 Sep 2026). Per-chunk overhead dominates: extraction re-sends the prompt scaffolding and
# writes graph JSON back for every chunk.
COGNIFY_USD_PER_TEXT_TOKEN = 2.5e-6
COGNIFY_USD_PER_CHUNK = 0.021


def estimate_cognify_usd(dataset: Dataset, chunk_size: int) -> float:
    tokens = deck_tokens(dataset)
    chunks = sum(max(1, math.ceil(t / chunk_size)) for t in tokens.values())
    return sum(tokens.values()) * COGNIFY_USD_PER_TEXT_TOKEN + chunks * COGNIFY_USD_PER_CHUNK


def cmd_estimate(args: argparse.Namespace) -> int:
    dataset = Dataset.load(args.course, args.source)
    n = len(dataset.reviewed())
    print(f"{n} reviewed question(s) of {len(dataset.questions)}")
    total = 0.0
    for chunk_size in args.chunk_sizes:
        ask = estimate_ask_usd(dataset, chunk_size, args.query_types, n)
        cognify = estimate_cognify_usd(dataset, chunk_size)
        total += ask["usd"] + cognify
        print(
            f"  {course_code(args.course, chunk_size):<14} cognify ~${cognify:.2f}  "
            f"asks {ask['asks']:>4} (~{ask['chunks']} chunks, "
            f"{ask['tokens_in'] / 1000:.0f}k in) ~${ask['usd']:.2f}"
        )
    judged = n * len(args.query_types) * len(args.chunk_sizes)
    print(f"matrix ~${total:.2f} in DeepSeek calls (order of magnitude; rates {PRICING})")
    print(
        f"plus {judged} judge calls on {judge_env(required=False)[0] or '<EVAL_JUDGE_MODEL unset>'}"
    )
    return 0


# In-process app


class App:
    """The API's objects without the API: Settings, Engine, Postgres, Ingest, and its lock."""

    def __init__(self) -> None:
        from filelock import FileLock, Timeout

        from lattice.config import Settings
        from lattice.db.session import Database
        from lattice.engine import Engine
        from lattice.ingest import Ingest

        self.settings = Settings()
        self.engine = Engine(self.settings)
        self.database = Database(self.settings)
        self.ingest = Ingest(self.database.sessionmaker, self.engine, self.settings)
        self.lock = FileLock(self.settings.cognee_root.resolve() / "note-ingest.lock", timeout=0)
        try:
            self.lock.acquire()
        except Timeout:
            sys.exit("the API holds the Cognee root; stop it before running the evaluation")

    async def start(self) -> None:
        await self.engine.start()

    async def close(self) -> None:
        await self.database.dispose()
        self.lock.release()

    async def ensure_course(self, code: str, name: str) -> None:
        from lattice.db.repo import courses, users

        async with self.database.sessionmaker() as session:
            user = await users.get_or_create(session, self.settings.instructor_email)
            course = await courses.by_code(session, code)
            if course is None:
                course = await courses.create(session, code=code, name=name, term=None, owner=user)
            principal = await self.engine.principal(user.email)
            if user.cognee_principal_id != principal.id:
                await users.set_principal(session, user, principal.id)
            _, private = await self.engine.enrol(course.code, principal)
            await courses.enrol(session, user=user, course=course, user_dataset_name=private.name)
            await session.commit()

    async def ensure_materials(
        self, code: str, files: list[Path], chunk_size: int
    ) -> dict[str, dict]:
        """Every deck ready in the course, cognified at `chunk_size` if it was not there yet.

        A Material counts as present only when Cognee still holds data under its name: a
        wiped or relocated Cognee root leaves Postgres saying `ready` for data that is gone,
        and a changed embedding model needs a fresh cognify anyway.

        Returns document identities per deck tag so Evidence can be mapped back to decks.
        """
        from cognee.modules.data.methods import get_dataset_data

        from lattice.db.repo import courses, materials, users

        dataset = await self.engine.global_dataset(code)
        held = {data.name for data in await get_dataset_data(dataset.id)}

        identities: dict[str, dict] = {}
        pending: list[tuple[str, Any]] = []
        async with self.database.sessionmaker() as session:
            user = await users.get_or_create(session, self.settings.instructor_email)
            course = await courses.by_code(session, code)
            for path in files:
                body = path.read_bytes()
                sha256 = hashlib.sha256(body).hexdigest()
                tag = path.stem.split(" ", 1)[0]
                row = await materials.by_sha256(session, course, sha256)
                if row is None:
                    target = (
                        self.settings.uploads_dir / course.code / f"{sha256}{path.suffix.lower()}"
                    )
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, target)
                    row = await materials.create(
                        session,
                        course=course,
                        uploader=user,
                        title=path.name,
                        filename=path.name,
                        storage_uri=str(target),
                        sha256=sha256,
                    )
                    await materials.update(
                        session,
                        row,
                        title=path.name,
                        page_count=None,
                        lecture_no=None,
                        kind="slides",
                    )
                identities[tag] = {
                    "material_id": str(row.id),
                    "filename": row.filename,
                    "sha256": sha256,
                }
                stored = Path(row.storage_uri).name  # `<sha>.pdf`; Cognee names Data by stem
                if row.status != "ready" or not held & {stored, Path(stored).stem}:
                    pending.append((tag, row.id))
            await session.commit()
        for tag, material_id in pending:
            print(f"  cognifying {tag} at chunk_size={chunk_size}", flush=True)
            await self.ingest.material(material_id, chunk_size=chunk_size)
            async with self.database.sessionmaker() as session:
                row = await materials.get(session, material_id)
                if row.status != "ready":
                    sys.exit(f"{tag} failed to cognify: {row.error}")
        return identities

    async def ask(self, code: str, question: str, query_type: str) -> dict:
        from lattice.study import AskRequest, ask_course

        async with self.database.sessionmaker() as session:
            response = await ask_course(
                self.engine,
                session,
                code,
                self.settings.instructor_email,
                AskRequest(question=question, query_type=query_type),
            )
            await session.commit()
        usage = await self.search_usage(response.session_id)
        return {**response.model_dump(mode="json"), "usage": usage}

    async def search_usage(self, session_id: str) -> dict | None:
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.pipelines.models import PipelineRun
        from sqlalchemy import select

        async with get_relational_engine().get_async_session() as session:
            rows = (
                (
                    await session.execute(
                        select(PipelineRun).where(
                            PipelineRun.operation_name == "search",
                            PipelineRun.session_id == session_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
        if not rows or all(r.tokens_in is None for r in rows):
            return None
        return {
            "tokens_in": sum(r.tokens_in or 0 for r in rows),
            "tokens_out": sum(r.tokens_out or 0 for r in rows),
        }

    async def cognify_usage(self, code: str) -> dict | None:
        from cognee.infrastructure.databases.relational import get_relational_engine
        from cognee.modules.pipelines.models import PipelineRun
        from sqlalchemy import select

        dataset = await self.engine.global_dataset(code)
        async with get_relational_engine().get_async_session() as session:
            rows = (
                (
                    await session.execute(
                        select(PipelineRun).where(
                            PipelineRun.operation_name == "cognify_pipeline",
                            PipelineRun.dataset_id == dataset.id,
                        )
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            return None
        return {
            "runs": len(rows),
            "tokens_in": sum(r.tokens_in or 0 for r in rows),
            "tokens_out": sum(r.tokens_out or 0 for r in rows),
        }


# Ask


async def run_ask(args: argparse.Namespace) -> int:
    dataset = Dataset.load(args.course, args.source)
    questions = dataset.reviewed()
    if not questions:
        sys.exit("no question has reviewed=true; review questions.json first")
    if args.limit:
        # One per deck first, so a trial touches every Material rather than only L01.
        by_deck = defaultdict(list)
        for question in questions:
            by_deck[question["deck"]].append(question)
        picked: list[dict] = []
        while len(picked) < args.limit and any(by_deck.values()):
            for group in by_deck.values():
                if group and len(picked) < args.limit:
                    picked.append(group.pop(0))
        questions = picked
    estimate = estimate_ask_usd(dataset, args.chunk_size, args.query_types, len(questions))
    cognify = estimate_cognify_usd(dataset, args.chunk_size)
    print(
        f"{len(questions)} questions x {len(args.query_types)} query types on "
        f"{course_code(args.course, args.chunk_size)}: ~${estimate['usd']:.2f} asks, "
        f"up to ~${cognify:.2f} cognify if not yet ingested"
    )
    if estimate["usd"] + cognify > args.ceiling:
        sys.exit(f"estimate exceeds ceiling ${args.ceiling:.2f}; raise --ceiling to proceed")

    app = App()
    try:
        await app.start()
        code = course_code(args.course, args.chunk_size)
        await app.ensure_course(code, f"{args.course} evaluation (chunk {args.chunk_size})")
        identities = await app.ensure_materials(code, list(dataset.decks.values()), args.chunk_size)
        record = {
            "course": args.course,
            "code": code,
            "chunk_size": args.chunk_size,
            "label": args.label,
            "query_types": args.query_types,
            "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "llm_model": os.environ.get("LLM_MODEL"),
            "embedding_model": os.environ.get("EMBEDDING_MODEL"),
            "materials": identities,
            "cognify_usage": await app.cognify_usage(code),
            "answers": [],
        }
        out = (
            dataset.root
            / "runs"
            / f"{record['started_at'][:19].replace(':', '')}-{code}-{args.label}.json"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        for index, question in enumerate(questions, 1):
            for query_type in args.query_types:
                text = question["question"]
                started = time.monotonic()
                try:
                    response = await app.ask(code, text, query_type)
                    error = None
                except Exception as exc:  # noqa: BLE001 - recorded, run continues
                    response, error = None, f"{type(exc).__name__}: {exc}"
                elapsed = int((time.monotonic() - started) * 1000)
                answer = {
                    "question_id": question["id"],
                    "query_type": query_type,
                    "question": text,
                    "response": response,
                    "error": error,
                    "wall_ms": elapsed,
                }
                answer["retrieval"] = retrieval_metrics(question, response, identities)
                record["answers"].append(answer)
                status = error or f"{elapsed} ms"
                print(
                    f"  [{index}/{len(questions)}] {question['id']} {query_type}: {status}",
                    flush=True,
                )
                out.write_text(json.dumps(record, indent=2), encoding="utf-8")
        record["finished_at"] = datetime.now(UTC).isoformat(timespec="seconds")
        out.write_text(json.dumps(record, indent=2), encoding="utf-8")
        print(f"wrote {out}")
    finally:
        await app.close()
    return 0


# Retrieval metrics


def deck_of(document_name: str | None, identities: dict[str, dict]) -> str | None:
    if not document_name:
        return None
    for tag, identity in identities.items():
        names = {identity["filename"], Path(identity["filename"]).stem, identity["sha256"]}
        if document_name in names or document_name.startswith(identity["sha256"]):
            return tag
    return None


def cited_spans(response: dict | None, identities: dict[str, dict]) -> list[dict]:
    """Every course-tier Evidence, mapped to a deck, in Cognee's rank order (unranked last)."""
    if response is None:
        return []
    spans = []
    for tier in response["turn"]["results"]:
        if tier["tier"] != "course":
            continue
        for item in tier["evidence"]:
            tag = deck_of(item.get("document_name"), identities)
            spans.append(
                {
                    "deck": tag,
                    "kind": item.get("kind"),
                    "page_start": item.get("page_start"),
                    "page_end": item.get("page_end"),
                    "rank": item.get("rank"),
                    "score": item.get("score"),
                }
            )
    spans.sort(key=lambda s: (s["rank"] is None, s["rank"] if s["rank"] is not None else 0))
    return spans


def retrieval_metrics(
    question: dict, response: dict | None, identities: dict[str, dict]
) -> dict | None:
    if question["type"] == "unanswerable":
        return None
    gold = {
        (g.get("deck") or question["deck"], g["page"]): g.get("required", True)
        for g in question["gold_pages"]
    }
    gold_decks = {d for d, _ in gold}
    spans = cited_spans(response, identities)
    cited_pages: set[tuple[str, int]] = set()
    first_hit_rank = None
    for position, span in enumerate(spans, 1):
        if span["deck"] and span["page_start"] and span["page_end"]:
            pages = {(span["deck"], p) for p in range(span["page_start"], span["page_end"] + 1)}
            cited_pages |= pages
            if first_hit_rank is None and pages & gold.keys():
                first_hit_rank = position
    contained = cited_pages & gold.keys()
    required = {k for k, r in gold.items() if r}
    return {
        "spans": spans,
        "material_hit": any(s["deck"] in gold_decks for s in spans),
        "page_containment": bool(contained),
        "page_precision": len(contained) / len(cited_pages) if cited_pages else 0.0,
        "full_recall": required <= cited_pages if required else bool(contained),
        "mrr": 1.0 / first_hit_rank if first_hit_rank else 0.0,
        "cited_pages": len(cited_pages),
        "span_width": statistics.mean(
            s["page_end"] - s["page_start"] + 1 for s in spans if s["page_start"] and s["page_end"]
        )
        if any(s["page_start"] for s in spans)
        else None,
    }


# Judge


def judge_env(required: bool = True) -> tuple[str | None, str | None]:
    model = os.environ.get("EVAL_JUDGE_MODEL")
    key = os.environ.get("EVAL_JUDGE_API_KEY")
    if not model:
        for line in (SERVER_ROOT / ".env").read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "EVAL_JUDGE_MODEL":
                model = value.strip().strip("\"'")
            if name.strip() == "EVAL_JUDGE_API_KEY":
                key = value.strip().strip("\"'")
    if not model and required:
        sys.exit("EVAL_JUDGE_MODEL is not set (server/.env)")
    return model, key


def judge_prompt(question: dict, answer: dict, dataset: Dataset) -> str:
    reference = question["reference"]
    facts = question["key_facts"]
    cited = []
    seen: set[tuple[str, int]] = set()
    for span in answer["retrieval"]["spans"] if answer.get("retrieval") else []:
        if not (span["deck"] and span["page_start"] and span["page_end"]):
            continue
        for page in range(span["page_start"], span["page_end"] + 1):
            if (span["deck"], page) in seen:
                continue
            seen.add((span["deck"], page))
            cited.append(
                f"--- {span['deck']} page {page} ---\n{dataset.page_text(span['deck'], page)}"
            )
    text = answer["response"]["turn"]["content"] if answer["response"] else ""
    marker = "UNANSWERABLE: yes" if question["type"] == "unanswerable" else "UNANSWERABLE: no"
    return "\n\n".join(
        [
            f"QUESTION:\n{answer['question']}",
            marker,
            f"REFERENCE ANSWER:\n{reference}",
            "KEY FACTS:\n" + "\n".join(f"{i + 1}. {f}" for i, f in enumerate(facts))
            if facts
            else "KEY FACTS: (none)",
            "CITED TEXT:\n" + ("\n\n".join(cited) if cited else "(empty)"),
            f"ANSWER TO GRADE:\n{text or '(no answer)'}",
        ]
    )


async def judge_one(model: str, key: str | None, prompt: str) -> dict:
    import litellm

    response = await litellm.acompletion(
        model=model,
        api_key=key,
        # No temperature: reasoning-family models (gpt-6-sol) reject anything but the default.
        messages=[{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "grade", "schema": JUDGE_SCHEMA, "strict": True},
        },
    )
    return json.loads(response.choices[0].message.content)


def acceptable(grade: dict) -> bool:
    return (
        grade["correctness"] == 2
        and grade["completeness"] >= 1
        and grade["faithfulness"] in (2, None)
    )


async def run_judge(args: argparse.Namespace) -> int:
    model, key = judge_env()
    run = load_json(args.run)
    dataset = Dataset.load(run["course"], args.source)
    questions = {q["id"]: q for q in dataset.questions}
    todo = [
        a for a in run["answers"] if args.force or a.get("judge") is None or "error" in a["judge"]
    ]
    print(f"judging {len(todo)} answer(s) with {model}")
    for index, answer in enumerate(todo, 1):
        question = questions[answer["question_id"]]
        prompt = judge_prompt(question, answer, dataset)
        try:
            grade = await judge_one(model, key, prompt)
            grade["acceptable"] = acceptable(grade)
            grade["model"] = model
        except Exception as exc:  # noqa: BLE001 - recorded, run continues
            grade = {"error": f"{type(exc).__name__}: {exc}", "model": model}
        answer["judge"] = grade
        print(
            f"  [{index}/{len(todo)}] {answer['question_id']} {answer['query_type']}: "
            f"{grade.get('error') or ('ok' if grade['acceptable'] else 'not ok')}",
            flush=True,
        )
        args.run.write_text(json.dumps(run, indent=2), encoding="utf-8")
    run["metrics"] = summarize(run, dataset)
    args.run.write_text(json.dumps(run, indent=2), encoding="utf-8")
    print_metrics(run)
    return 0


# Metrics


def mean(values: list[float]) -> float | None:
    return statistics.mean(values) if values else None


def summarize(run: dict, dataset: Dataset) -> dict:
    questions = {q["id"]: q for q in dataset.questions}
    by_type: dict[str, list[dict]] = defaultdict(list)
    for answer in run["answers"]:
        by_type[answer["query_type"]].append(answer)
    out = {}
    for query_type, answers in by_type.items():
        answerable = [a for a in answers if questions[a["question_id"]]["type"] != "unanswerable"]
        unanswerable = [a for a in answers if questions[a["question_id"]]["type"] == "unanswerable"]
        judged = [a for a in answers if a.get("judge") and "error" not in a["judge"]]
        judged_answerable = [
            a for a in judged if questions[a["question_id"]]["type"] != "unanswerable"
        ]
        retrieval = [a["retrieval"] for a in answerable if a.get("retrieval")]
        latencies = sorted(
            a["response"]["turn"]["latency_ms"]
            for a in answers
            if a["response"] and a["response"]["turn"]["latency_ms"] is not None
        )
        usage = [
            a["response"]["usage"] for a in answers if a["response"] and a["response"].get("usage")
        ]
        out[query_type] = {
            "n": len(answers),
            "errors": sum(1 for a in answers if a["error"]),
            "material_hit": mean([float(r["material_hit"]) for r in retrieval]),
            "page_containment": mean([float(r["page_containment"]) for r in retrieval]),
            "page_precision": mean([r["page_precision"] for r in retrieval]),
            "full_recall": mean([float(r["full_recall"]) for r in retrieval]),
            "mrr": mean([r["mrr"] for r in retrieval]),
            "span_width": mean([r["span_width"] for r in retrieval if r["span_width"] is not None]),
            "acceptable": mean([float(a["judge"]["acceptable"]) for a in judged_answerable]),
            "correctness": mean([a["judge"]["correctness"] for a in judged_answerable]),
            "completeness": mean([a["judge"]["completeness"] for a in judged_answerable]),
            "faithfulness": mean(
                [
                    a["judge"]["faithfulness"]
                    for a in judged_answerable
                    if a["judge"]["faithfulness"] is not None
                ]
            ),
            "faithfulness_unscored": mean(
                [float(a["judge"]["faithfulness"] is None) for a in judged_answerable]
            ),
            "abstention_rate": mean(
                [
                    float(a["judge"]["abstained"])
                    for a in judged
                    if questions[a["question_id"]]["type"] == "unanswerable"
                ]
            ),
            "false_abstention_rate": mean(
                [float(a["judge"]["abstained"]) for a in judged_answerable]
            ),
            "latency_p50_ms": latencies[len(latencies) // 2] if latencies else None,
            "latency_p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]
            if latencies
            else None,
            "tokens_in_per_ask": mean([u["tokens_in"] for u in usage]),
            "tokens_out_per_ask": mean([u["tokens_out"] for u in usage]),
            "usd_per_ask": mean(
                [
                    u["tokens_in"] / 1e6 * INPUT_USD_PER_MTOK
                    + u["tokens_out"] / 1e6 * OUTPUT_USD_PER_MTOK
                    for u in usage
                ]
            ),
            "judged": len(judged),
            "unanswerable_n": len(unanswerable),
            "by_question_type": {
                kind: {
                    "n": len(group),
                    "acceptable": mean(
                        [
                            float(a["judge"]["acceptable"])
                            for a in group
                            if a.get("judge") and "error" not in a["judge"]
                        ]
                    ),
                    "page_containment": mean(
                        [
                            float(a["retrieval"]["page_containment"])
                            for a in group
                            if a.get("retrieval")
                        ]
                    ),
                }
                for kind, group in _group_by_type(answers, questions).items()
            },
        }
    return out


def _group_by_type(answers: list[dict], questions: dict[str, dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for answer in answers:
        groups[questions[answer["question_id"]]["type"]].append(answer)
    return dict(groups)


COLUMNS = (
    ("material_hit", "Mat-hit"),
    ("page_containment", "Page-cont"),
    ("page_precision", "Page-prec"),
    ("full_recall", "Full-rec"),
    ("mrr", "MRR"),
    ("span_width", "Span"),
    ("acceptable", "Accept"),
    ("correctness", "Corr"),
    ("completeness", "Compl"),
    ("faithfulness", "Faith"),
    ("abstention_rate", "Abstain"),
    ("latency_p50_ms", "p50ms"),
    ("usd_per_ask", "$/ask"),
)


def fmt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.3f}" if value < 10 else f"{value:.1f}"
    return str(value)


def print_metrics(run: dict) -> None:
    print(f"\n{run['code']} (chunk {run['chunk_size']}, {run['label']})")
    header = "| Query type | " + " | ".join(label for _, label in COLUMNS) + " |"
    print(header)
    print("|" + "---|" * (len(COLUMNS) + 1))
    for query_type, metrics in run["metrics"].items():
        print(f"| {query_type} | " + " | ".join(fmt(metrics.get(key)) for key, _ in COLUMNS) + " |")


def cmd_report(args: argparse.Namespace) -> int:
    runs_dir = Path(__file__).resolve().parent / args.course / "runs"
    runs = [load_json(p) for p in sorted(runs_dir.glob("*.json"))]
    judged = [r for r in runs if r.get("metrics")]
    if not judged:
        sys.exit("no judged runs; run `judge` first")
    print(
        "| Course | Chunk | Label | Query type | "
        + " | ".join(label for _, label in COLUMNS)
        + " |"
    )
    print("|" + "---|" * (len(COLUMNS) + 4))
    for run in judged:
        for query_type, metrics in run["metrics"].items():
            cells = [run["code"], str(run["chunk_size"]), run["label"], query_type]
            print(
                "| "
                + " | ".join(cells)
                + " | "
                + " | ".join(fmt(metrics.get(key)) for key, _ in COLUMNS)
                + " |"
            )
    repeats = defaultdict(list)
    for run in judged:
        repeats[(run["code"], run["chunk_size"])].append(run)
    for key, group in repeats.items():
        if len(group) < 2:
            continue
        print(f"\nrun-to-run variance on {key[0]} ({len(group)} runs):")
        for query_type in group[0]["metrics"]:
            for metric in ("acceptable", "page_containment"):
                values = [
                    g["metrics"][query_type][metric]
                    for g in group
                    if g["metrics"].get(query_type, {}).get(metric) is not None
                ]
                if len(values) >= 2:
                    print(
                        f"  {query_type} {metric}: mean {statistics.mean(values):.3f}, "
                        f"sd {statistics.stdev(values):.3f}"
                    )
    return 0


# Calibration


def cmd_sample(args: argparse.Namespace) -> int:
    run = load_json(args.run)
    dataset = Dataset.load(run["course"], args.source)
    questions = {q["id"]: q for q in dataset.questions}
    judged = [a for a in run["answers"] if a.get("judge") and "error" not in a["judge"]]
    strata: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for answer in judged:
        strata[(questions[answer["question_id"]]["type"], answer["query_type"])].append(answer)
    rng = random.Random(args.seed)
    picked: list[dict] = []
    while len(picked) < min(args.n, len(judged)):
        for group in strata.values():
            if group and len(picked) < args.n:
                picked.append(group.pop(rng.randrange(len(group))))
    sheet = {
        "run": str(args.run),
        "instructions": (
            "Fill human_correctness/completeness (0-2) and human_acceptable (bool) per item, "
            "then run `kappa --sheet`."
        ),
        "items": [
            {
                "question_id": a["question_id"],
                "query_type": a["query_type"],
                "question": a["question"],
                "reference": questions[a["question_id"]]["reference"],
                "key_facts": questions[a["question_id"]]["key_facts"],
                "answer": a["response"]["turn"]["content"] if a["response"] else "",
                "judge": {k: a["judge"][k] for k in ("correctness", "completeness", "acceptable")},
                "human_correctness": None,
                "human_completeness": None,
                "human_acceptable": None,
            }
            for a in picked
        ],
    }
    args.out.write_text(json.dumps(sheet, indent=2), encoding="utf-8")
    print(f"wrote {len(picked)} items to {args.out}")
    return 0


def cohen_kappa(pairs: list[tuple[Any, Any]]) -> float | None:
    if not pairs:
        return None
    n = len(pairs)
    agree = sum(1 for a, b in pairs) and sum(1 for a, b in pairs if a == b) / n
    left, right = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    expected = sum(left[c] * right[c] for c in set(left) | set(right)) / (n * n)
    return 1.0 if expected == 1 else (agree - expected) / (1 - expected)


def cmd_kappa(args: argparse.Namespace) -> int:
    sheet = load_json(args.sheet)
    graded = [i for i in sheet["items"] if i["human_acceptable"] is not None]
    print(f"{len(graded)} of {len(sheet['items'])} items hand-graded")
    for field in ("acceptable", "correctness", "completeness"):
        pairs = [
            (i["judge"][field], i[f"human_{field}"])
            for i in graded
            if i[f"human_{field}"] is not None
        ]
        kappa = cohen_kappa(pairs)
        print(f"  {field}: kappa {fmt(kappa)} on {len(pairs)} items")
    return 0


# CLI


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--course", default="CS4223", help="dataset under eval/ (default %(default)s)"
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="directory of the course's seed PDFs (default data/seed/<COURSE>)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    estimate = sub.add_parser("estimate", help="cost of the whole matrix, no calls")
    estimate.add_argument(
        "--chunk-sizes",
        default=",".join(map(str, CHUNK_SIZES)),
        type=lambda s: [int(x) for x in s.split(",")],
    )
    estimate.add_argument(
        "--query-types", default=",".join(QUERY_TYPES), type=lambda s: s.split(",")
    )

    ask = sub.add_parser("ask", help="ingest if needed, then ask every reviewed question")
    ask.add_argument("--chunk-size", type=int, required=True)
    ask.add_argument("--query-types", default=",".join(QUERY_TYPES), type=lambda s: s.split(","))
    ask.add_argument(
        "--label", default="r1", help="distinguishes repeats of one config (default %(default)s)"
    )
    ask.add_argument(
        "--limit",
        type=int,
        default=0,
        help="trial run: only this many reviewed questions, spread across decks (default: all)",
    )
    ask.add_argument(
        "--ceiling",
        type=float,
        default=10.0,
        help="refuse above this USD estimate (default %(default)s)",
    )

    judge = sub.add_parser("judge", help="grade a run's answers and compute its metrics")
    judge.add_argument("--run", type=Path, required=True)
    judge.add_argument(
        "--force", action="store_true", help="re-judge answers that already have a grade"
    )

    sub.add_parser("report", help="one table across every judged run")

    sample = sub.add_parser("sample", help="stratified hand-grading sheet from a judged run")
    sample.add_argument("--run", type=Path, required=True)
    sample.add_argument("--n", type=int, default=30)
    sample.add_argument("--seed", type=int, default=0)
    sample.add_argument("--out", type=Path, required=True)

    kappa = sub.add_parser("kappa", help="Cohen's kappa between judge and human on a filled sheet")
    kappa.add_argument("--sheet", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    if args.command == "estimate":
        return cmd_estimate(args)
    if args.command == "ask":
        return asyncio.run(run_ask(args))
    if args.command == "judge":
        return asyncio.run(run_judge(args))
    if args.command == "report":
        return cmd_report(args)
    if args.command == "sample":
        return cmd_sample(args)
    if args.command == "kappa":
        return cmd_kappa(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
