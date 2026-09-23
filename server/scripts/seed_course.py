"""Seed a course and its lecture Materials into a running API.

Drives the RPC endpoints an instructor would use — `courses.create`, `enrolments.join`,
`materials.upload`, `materials.update` — with dev-header identity, so seeding exercises the
real upload and Cognify path. Re-running is safe: an existing code comes back as a 409
carrying the course, and `materials.upload` is content-addressed, so the same bytes rejoin
the existing Material and cognify nothing.

    uv run python scripts/seed_course.py                       # data/seed/CS4223, waits for ingest
    uv run python scripts/seed_course.py --only L00,L01        # two decks
    uv run python scripts/seed_course.py --source ~/CS4223.zip --no-wait

Slide bytes are not in the repository. Put them under `data/seed/<CODE>/` (ignored), or
point `--source` at the zip. Cognifying a deck spends real LLM calls.
"""

import argparse
import logging
import os
import re
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

import httpx
from pypdf import PdfReader

SERVER_ROOT = Path(__file__).resolve().parents[1]

# "L02a - Instruction Level Parallelism - Part I.pdf": lecture 2, second file of that lecture.
LECTURE = re.compile(r"^L(?P<number>\d+)(?P<part>[a-z]?)\s*-\s*(?P<title>.+)$")
SUFFIXES = {".pdf", ".pptx", ".md", ".txt"}
TERMINAL = {"ready", "failed"}

# Cost of the LLM calls a first-time Cognify spends, as an order of magnitude rather than a
# quote. The rates are DeepSeek's peak cache-miss ones the probe ledger also uses
# (`scripts/probe_runtime.py`, checked 20 Sep 2026); the multipliers are crude: extraction
# resends each chunk inside prompts a few times over and writes graph JSON back out, and
# neither number is measured usage. Extracted text is also the floor, since a slide's figures
# carry content no text layer holds.
PRICING = "https://api-docs.deepseek.com/quick_start/pricing"
INPUT_USD_PER_MTOK = 0.30
OUTPUT_USD_PER_MTOK = 1.20
CHARS_PER_TOKEN = 4
INPUT_TOKENS_PER_TEXT_TOKEN = 3.0
OUTPUT_TOKENS_PER_TEXT_TOKEN = 1.0


@dataclass(frozen=True)
class Deck:
    """One file to upload, with the metadata its name and bytes already carry."""

    path: Path
    title: str
    lecture_no: int | None
    page_count: int | None
    text_chars: int

    @property
    def tag(self) -> str:
        return tag_of(self.path)


def tag_of(path: Path) -> str:
    """The `L02a` part of the filename, which is what `--only` matches."""
    return path.stem.split(" ", 1)[0]


def measure(path: Path) -> tuple[int | None, int]:
    """Pages and extracted characters: metadata for the record, and the cost estimate's input."""
    if path.suffix.lower() != ".pdf":
        return None, len(path.read_bytes()) if path.suffix.lower() in {".md", ".txt"} else 0
    try:
        pages = PdfReader(str(path)).pages
        return len(pages), sum(len(page.extract_text() or "") for page in pages)
    except Exception as exc:  # noqa: BLE001 - a nicety, not a reason to stop seeding
        print(f"  ! could not read {path.name}: {exc}")
        return None, 0


def deck(path: Path) -> Deck:
    match = LECTURE.match(path.stem)
    pages, chars = measure(path)
    return Deck(
        path=path,
        title=match["title"].strip() if match else path.stem,
        lecture_no=int(match["number"]) if match else None,
        page_count=pages,
        text_chars=chars,
    )


def estimate_usd(chosen: list[Deck]) -> tuple[int, float]:
    """Text tokens across the files, and the dollars a first-time Cognify of them may cost."""
    tokens = sum(item.text_chars for item in chosen) / CHARS_PER_TOKEN
    usd = (
        tokens * INPUT_TOKENS_PER_TEXT_TOKEN * INPUT_USD_PER_MTOK
        + tokens * OUTPUT_TOKENS_PER_TEXT_TOKEN * OUTPUT_USD_PER_MTOK
    ) / 1_000_000
    return int(tokens), usd


def unpacked(archive: Path, into: Path) -> Path:
    """Members of a zip, minus the `__MACOSX` resource forks a macOS zip carries."""
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            name = Path(member.filename)
            if member.is_dir() or name.parts[0] == "__MACOSX" or name.name.startswith("."):
                continue
            target = into / name.name
            target.write_bytes(zf.read(member))
    return into


def decks(source: Path, only: list[str], into: Path) -> list[Deck]:
    if source.is_file() and source.suffix.lower() == ".zip":
        source = unpacked(source, into)
    if not source.is_dir():
        raise SystemExit(f"no such seed source: {source}")
    found = sorted(p for p in source.iterdir() if p.suffix.lower() in SUFFIXES)
    if not found:
        raise SystemExit(f"{source} holds no {', '.join(sorted(SUFFIXES))} file")
    if only:
        wanted = {tag.lower() for tag in only}
        found = [p for p in found if tag_of(p).lower() in wanted]
        missing = wanted - {tag_of(p).lower() for p in found}
        if missing:
            raise SystemExit(f"--only names nothing in {source}: {', '.join(sorted(missing))}")
    return [deck(p) for p in found]


class Api:
    """The RPC calls this script makes, as the one dev-header identity it seeds with."""

    def __init__(self, base_url: str, user: str, timeout: float) -> None:
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"X-User": user}, timeout=timeout
        )
        self.user = user

    def __enter__(self) -> Api:
        return self

    def __exit__(self, *_: object) -> None:
        self.client.close()

    def _json(self, response: httpx.Response) -> dict:
        response.raise_for_status()
        return response.json()

    def me(self) -> dict:
        return self._json(self.client.get("/me.get"))

    def course(self, code: str, name: str, term: str | None) -> tuple[dict, bool]:
        """The course, and whether this run created it."""
        response = self.client.post(
            "/courses.create", json={"code": code, "name": name, "term": term}
        )
        if response.status_code == 409:
            detail = response.json()["detail"]
            if detail.get("reason") != "course_exists":
                response.raise_for_status()
            return detail["course"], False
        return self._json(response), True

    def join(self, code: str) -> dict:
        return self._json(self.client.post("/enrolments.join", json={"course": code}))

    def upload(self, code: str, path: Path) -> tuple[dict, bool]:
        """The Material, and whether the course already held these bytes."""
        with path.open("rb") as handle:
            body = self._json(
                self.client.post(
                    "/materials.upload",
                    data={"course": code},
                    files={"file": (path.name, handle, "application/octet-stream")},
                )
            )
        return body["material"], body["deduplicated"]

    def describe(self, material: str, deck: Deck) -> dict:
        payload: dict[str, object] = {"material": material, "title": deck.title, "kind": "slides"}
        if deck.lecture_no is not None:
            payload["lecture_no"] = deck.lecture_no
        if deck.page_count is not None:
            payload["page_count"] = deck.page_count
        return self._json(self.client.post("/materials.update", json=payload))

    def material(self, material: str) -> dict:
        return self._json(self.client.get("/materials.get", params={"material": material}))


def wait(api: Api, pending: dict[str, str], deadline: float, poll: float) -> dict[str, dict]:
    """Poll queued Materials until each is ready or failed, reporting as they settle."""
    settled: dict[str, dict] = {}
    while pending and time.monotonic() < deadline:
        time.sleep(poll)
        for material_id, tag in list(pending.items()):
            row = api.material(material_id)
            if row["status"] not in TERMINAL:
                continue
            del pending[material_id]
            settled[material_id] = row
            detail = f": {row['error']}" if row["error"] else ""
            print(f"  {tag} {row['status']}{detail}")
    for material_id, tag in pending.items():
        print(f"  {tag} still {api.material(material_id)['status']} when the wait ran out")
    return settled


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--course", default="cs4223", help="course code, lowercase (default %(default)s)"
    )
    parser.add_argument("--name", default="Multi-core Architectures", help="course name")
    parser.add_argument("--term", default=None, help="course term, e.g. 2026/27 S1")
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="directory or zip holding the files (default data/seed/<COURSE in caps>)",
    )
    parser.add_argument(
        "--only",
        default="",
        help="comma-separated filename tags to seed, e.g. L00,L01 (default: every file)",
    )
    parser.add_argument("--api", default="http://localhost:8000", help="API base URL")
    parser.add_argument(
        "--user",
        default=os.environ.get("INSTRUCTOR_EMAIL", "instructor@lattice.example"),
        help="X-User identity that owns the course and uploads (default %(default)s)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="list what would be uploaded and stop"
    )
    parser.add_argument(
        "--yes", action="store_true", help="skip the cost confirmation (implied when not a TTY)"
    )
    parser.add_argument(
        "--no-wait", action="store_true", help="return once uploaded, without awaiting ingest"
    )
    parser.add_argument(
        "--ingest-timeout",
        type=float,
        default=1800.0,
        help="seconds to wait for all ingest to settle (default %(default)s)",
    )
    parser.add_argument("--poll", type=float, default=5.0, help="seconds between status polls")
    parser.add_argument("--request-timeout", type=float, default=120.0, help="per-request timeout")
    return parser.parse_args(argv)


def seed(args: argparse.Namespace, chosen: list[Deck]) -> int:
    with Api(args.api, args.user, args.request_timeout) as api:
        api.me()
        course, created = api.course(args.course, args.name, args.term)
        print(f"{'created' if created else 'reusing'} course {course['code']}: {course['name']}")
        api.join(course["code"])
        print(f"enrolled {api.user}")

        pending: dict[str, str] = {}
        for item in chosen:
            material, deduplicated = api.upload(course["code"], item.path)
            material = api.describe(material["id"], item)
            state = "deduplicated" if deduplicated else material["status"]
            print(f"  {item.tag} {item.path.name} -> {state}")
            if not deduplicated and material["status"] not in TERMINAL:
                pending[material["id"]] = item.tag

        if args.no_wait or not pending:
            return 0
        print(f"waiting for {len(pending)} material(s) to cognify")
        settled = wait(api, pending, time.monotonic() + args.ingest_timeout, args.poll)
        failed = [row for row in settled.values() if row["status"] == "failed"]
        if failed or pending:
            return 1
    return 0


def report(chosen: list[Deck], source: Path) -> None:
    total = sum(item.path.stat().st_size for item in chosen)
    tokens, usd = estimate_usd(chosen)
    print(f"{len(chosen)} file(s), {total / 1_048_576:.1f} MB from {source}")
    for item in chosen:
        pages = f", {item.page_count} pages" if item.page_count else ""
        print(f"  {item.tag} {item.title}{pages}")
    print(
        f"cognifying all of this costs roughly US${usd:.2f} in LLM calls "
        f"({tokens / 1000:.0f}k tokens of extracted text; order of magnitude, not a quote)"
    )
    print(f"already-cognified files cost nothing to re-seed. Rates: {PRICING}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)  # so a piped or tee'd run reports as it goes
    logging.getLogger("pypdf").setLevel(logging.ERROR)  # font warnings from text extraction
    source = args.source or SERVER_ROOT / "data" / "seed" / args.course.upper()
    only = [tag.strip() for tag in args.only.split(",") if tag.strip()]
    with tempfile.TemporaryDirectory() as tmp:
        chosen = decks(source, only, Path(tmp))
        report(chosen, source)
        if args.dry_run:
            return 0
        if not args.yes and sys.stdin.isatty():
            if input("seed these into the API? [y/N] ").strip().lower() not in {"y", "yes"}:
                return 1
        return seed(args, chosen)


if __name__ == "__main__":
    sys.exit(main())
