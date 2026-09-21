import asyncio
import hashlib
import io
import json
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from xml.etree import ElementTree
from zipfile import ZipFile

from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.config import Settings
from lattice.db.models import Material, Note, User
from lattice.db.repo import courses, materials, notes, users
from lattice.db.repo.notes import RevisionConflict as RevisionConflict

Course = Annotated[str, Field(pattern=r"^[a-z][a-z0-9]{1,15}$")]
Filename = Annotated[str, Field(min_length=1, max_length=200, pattern=r'^[^\\/:*?"<>|\x00-\x1f]+$')]
MaterialId = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
NoteText = Annotated[str, Field(max_length=50_000)]


class PageAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    course: Course
    filename: Filename
    material_id: MaterialId
    page_number: int = Field(ge=1)


class MaterialContext(BaseModel):
    course: Course
    filename: Filename
    material_id: MaterialId
    page_count: int
    topic: None = None


class PageNote(BaseModel):
    id: str
    anchor: PageAnchor
    owner: str
    body_md: NoteText
    revision: int
    content_hash: str
    cognified_revision: int
    status: Literal["empty", "queued", "cognifying", "ready", "failed", "stored"]
    updated_at: datetime | None
    run_after: datetime | None
    attempts: int = 0
    error: str | None = None
    cognify_enabled: bool = True


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def material_context(root: Path, course: str, filename: str, max_bytes: int) -> MaterialContext:
    PageAnchor(course=course, filename=filename, material_id="0" * 64, page_number=1)
    folder = (root / course).resolve()
    path = folder / filename
    if folder.parent != root.resolve() or path.resolve().parent != folder or not path.is_file():
        raise ValueError("Material is not available in this course")
    with path.open("rb") as stream:
        content = stream.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError("Material exceeds the configured size limit")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        count = len(PdfReader(io.BytesIO(content)).pages)
    elif suffix == ".pptx":
        with ZipFile(io.BytesIO(content)) as archive:
            entry = archive.getinfo("ppt/presentation.xml")
            if entry.file_size > 1_000_000:
                raise ValueError("Presentation metadata exceeds the size limit")
            presentation = ElementTree.fromstring(archive.read(entry))
        count = len(presentation.findall("{*}sldIdLst/{*}sldId"))
    elif suffix in {".md", ".txt"}:
        count = 1
    else:
        raise ValueError("Unsupported Material format")
    if count < 1:
        raise ValueError("Material has no Pages")
    return MaterialContext(
        course=course,
        filename=filename,
        material_id=hashlib.sha256(content).hexdigest(),
        page_count=count,
    )


class PageNotes:
    def __init__(self, session: AsyncSession, settings: Settings, *, delay_seconds: float = 5):
        self.session = session
        self.settings = settings
        self.delay_seconds = delay_seconds

    async def _context(self, course: str, material: Material) -> MaterialContext:
        path = Path(material.storage_uri).resolve()
        if path.parent != (self.settings.uploads_dir / course).resolve():
            raise ValueError("Material storage does not match this course")
        result = await asyncio.to_thread(
            material_context,
            self.settings.uploads_dir,
            course,
            path.name,
            self.settings.max_upload_mb * 1024**2,
        )
        if result.material_id != material.sha256:
            raise ValueError("Material content changed; obtain its current Page context")
        return result.model_copy(update={"filename": material.filename})

    async def context(self, owner: str, course: str, filename: str) -> MaterialContext:
        user = await users.get_or_create(self.session, owner)
        row = await courses.require_enrolment(self.session, user, course)
        found = list(
            await self.session.scalars(
                select(Material)
                .where(Material.course_id == row.id, Material.filename == filename)
                .order_by(Material.created_at.desc())
                .limit(1)
            )
        )
        if not found:
            raise ValueError("Material is not available in this course")
        return await self._context(course, found[0])

    async def _anchor(self, owner: str, anchor: PageAnchor):
        user = await users.get_or_create(self.session, owner)
        course = await courses.require_enrolment(self.session, user, anchor.course)
        material = await materials.by_sha256(self.session, course, anchor.material_id)
        if material is None or material.filename != anchor.filename:
            raise ValueError("Material is not available in this course")
        context = await self._context(course.code, material)
        if anchor.page_number > context.page_count:
            raise ValueError("Page does not exist in this Material")
        return user, course, material

    def _result(self, user: User, anchor: PageAnchor, note: Note | None) -> PageNote:
        if note is None:
            return PageNote(
                id=text_hash(
                    json.dumps([user.email, anchor.course, anchor.material_id, anchor.page_number])
                ),
                anchor=anchor,
                owner=user.email,
                body_md="",
                revision=0,
                content_hash=text_hash(""),
                cognified_revision=0,
                status="empty",
                updated_at=None,
                run_after=None,
                cognify_enabled=not user.notes_opt_out,
            )
        status = {"dirty": "queued", "indexing": "cognifying"}.get(note.status, note.status)
        if user.notes_opt_out and note.status == "dirty":
            status = "stored"
        return PageNote(
            id=str(note.id),
            anchor=anchor,
            owner=user.email,
            body_md=note.body_md,
            revision=note.revision,
            content_hash=text_hash(note.body_md),
            cognified_revision=note.cognified_revision,
            status=status,
            updated_at=note.updated_at,
            run_after=note.run_after,
            attempts=note.ingest_attempts,
            error=note.error,
            cognify_enabled=not user.notes_opt_out,
        )

    async def get(self, owner: str, anchor: PageAnchor) -> PageNote:
        user, _, material = await self._anchor(owner, anchor)
        note = await notes.anchored(
            self.session, user=user, material=material, page=anchor.page_number
        )
        return self._result(user, anchor, note)

    async def upsert(
        self, owner: str, anchor: PageAnchor, body_md: str, *, expected_revision: int
    ) -> PageNote:
        user, course, material = await self._anchor(owner, anchor)
        note = await notes.save(
            self.session,
            user=user,
            course=course,
            material=material,
            page=anchor.page_number,
            body_md=body_md,
            expected_revision=expected_revision,
            delay_seconds=self.delay_seconds,
        )
        return self._result(user, anchor, note)
