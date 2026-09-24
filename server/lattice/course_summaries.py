"""Course summaries: one vector per course, refreshed on a timer, for choosing related courses.

Each ready Material contributes a short profile (title, week, kind, Topic labels, the first
Page's text) embedded with the model Cognify uses; the course's vector is their unit-length
mean. Per Material rather than one long text, so every Material weighs the same however
long it is and a course's later Materials are not crowded out. No LLM is involved. Like
Note ingest, this runs inside the API process until there is a Worker.
"""

import asyncio
import hashlib
import logging
import math
from pathlib import Path

from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice.config import Settings
from lattice.db.models import Course, Material
from lattice.db.repo import course_summaries, courses, materials
from lattice.engine import Engine

log = logging.getLogger(__name__)

# How much of a Material stands for it: its record plus the opening of its first Page.
PROFILE_CHARS = 1_500


def material_profile(material: Material, page_text: str) -> str:
    """The text that stands for one Material: its record first, then its first Page."""
    facts = [material.title]
    if material.week is not None:
        facts.append(f"week {material.week}")
    if material.kind:
        facts.append(material.kind)
    lines = [", ".join(facts)]
    if material.topics:
        lines.append("Topics: " + "; ".join(topic.label for topic in material.topics))
    if page_text.strip():
        lines.append(" ".join(page_text.split()))
    return "\n".join(lines)[:PROFILE_CHARS]


def first_page_text(path: Path) -> str:
    """The first Page of a stored Material, or nothing when the file cannot be read: a
    Material that will not open still contributes its record to the profile."""
    try:
        if path.suffix.lower() == ".pdf":
            with path.open("rb") as stream:
                return PdfReader(stream).pages[0].extract_text() or ""
        return path.read_text(encoding="utf-8", errors="replace")[:PROFILE_CHARS]
    except Exception:  # noqa: BLE001 - one unreadable file must not skip the whole course
        log.warning("could not read %s for its course summary", path, exc_info=True)
        return ""


def source_digest(ready: list[Material]) -> str:
    """Changes when a ready Material is added, removed, retitled or given new Topics."""
    parts = sorted(
        f"{m.sha256}|{m.title}|{m.week}|{m.kind}|" + ";".join(t.label for t in m.topics)
        for m in ready
    )
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def mean_pooled(vectors: list[list[float]]) -> list[float]:
    """The unit-length mean: every Material weighs the same, however long it is."""
    width = len(vectors[0])
    mean = [sum(vector[i] for vector in vectors) / len(vectors) for i in range(width)]
    norm = math.sqrt(sum(x * x for x in mean)) or 1.0
    return [x / norm for x in mean]


class CourseSummaries:
    def __init__(
        self, sessionmaker: async_sessionmaker, engine: Engine, settings: Settings
    ) -> None:
        self.sessionmaker = sessionmaker
        self.engine = engine
        self.settings = settings

    async def run_forever(self) -> None:
        """Refresh at start-up, then every `course_summary_refresh_s`; a failed pass is
        logged and retried on the next tick rather than ending the loop."""
        while True:
            try:
                await self.refresh_all()
            except Exception:  # noqa: BLE001 - the next tick retries; the API must keep serving
                log.exception("course summary refresh failed")
            await asyncio.sleep(self.settings.course_summary_refresh_s)

    async def refresh_all(self) -> list[str]:
        """Recompute every course whose ready Materials or embedding model changed, and drop
        the summary of any course left without a ready Material. Returns the codes refreshed."""
        model = self.engine.embedding_model()
        refreshed = []
        async with self.sessionmaker() as session:
            for course in await courses.all_courses(session):
                if await self._refresh(session, course, model):
                    refreshed.append(course.code)
            await session.commit()
        return refreshed

    async def _refresh(self, session: AsyncSession, course: Course, model: str) -> bool:
        ready = [m for m in await materials.for_course(session, course) if m.status == "ready"]
        existing = await course_summaries.get(session, course)
        if not ready:
            if existing is not None:
                await course_summaries.remove(session, course)
            return False
        digest = source_digest(ready)
        if existing is not None and (existing.source_digest, existing.embedding_model) == (
            digest,
            model,
        ):
            return False
        texts = await asyncio.gather(
            *(asyncio.to_thread(first_page_text, Path(m.storage_uri)) for m in ready)
        )
        profiles = [material_profile(m, text) for m, text in zip(ready, texts, strict=True)]
        vectors = await self.engine.embed(profiles)
        await course_summaries.upsert(
            session,
            course,
            summary_text="\n\n".join(profiles),
            embedding=mean_pooled(vectors),
            embedding_model=model,
            source_digest=digest,
        )
        return True
