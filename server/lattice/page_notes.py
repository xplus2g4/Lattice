import asyncio
import hashlib
import io
import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from xml.etree import ElementTree
from zipfile import ZipFile

from filelock import FileLock
from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader

from lattice.registry import now

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
    status: Literal["empty", "queued", "cognifying", "ready", "failed"]
    updated_at: datetime | None
    run_after: datetime | None
    attempts: int = 0
    error: str | None = None


class RevisionConflict(ValueError):
    pass


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
    def __init__(
        self, uploads_dir: Path, *, delay_seconds: float = 5, max_bytes: int = 25 * 1024**2
    ):
        self.uploads_dir = uploads_dir
        self.root = uploads_dir / ".page-notes"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = FileLock(self.root / "records.lock", timeout=5)
        self.delay_seconds = delay_seconds
        self.max_bytes = max_bytes

    def context(self, course: str, filename: str) -> MaterialContext:
        return material_context(self.uploads_dir, course, filename, self.max_bytes)

    def validate_anchor(self, anchor: PageAnchor) -> None:
        context = self.context(anchor.course, anchor.filename)
        if context.material_id != anchor.material_id:
            raise ValueError("Material content changed; obtain its current Page context")
        if anchor.page_number > context.page_count:
            raise ValueError("Page does not exist in this Material")

    def _empty(self, owner: str, anchor: PageAnchor) -> PageNote:
        identity = json.dumps([owner, anchor.course, anchor.material_id, anchor.page_number])
        return PageNote(
            id=text_hash(identity),
            anchor=anchor,
            owner=owner,
            body_md="",
            revision=0,
            content_hash=text_hash(""),
            cognified_revision=0,
            status="empty",
            updated_at=None,
            run_after=None,
        )

    def _read(self, empty: PageNote) -> PageNote:
        path = self.root / f"{empty.id}.json"
        return PageNote.model_validate_json(path.read_bytes()) if path.exists() else empty

    def _write(self, note: PageNote) -> None:
        with tempfile.NamedTemporaryFile(dir=self.root, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            try:
                stream.write(note.model_dump_json().encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            except BaseException:
                stream.close()
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary, self.root / f"{note.id}.json")
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, owner: str, anchor: PageAnchor) -> PageNote:
        self.validate_anchor(anchor)
        with self.lock:
            return self._read(self._empty(owner, anchor))

    def upsert(
        self, owner: str, anchor: PageAnchor, body_md: str, *, expected_revision: int
    ) -> PageNote:
        self.validate_anchor(anchor)
        with self.lock:
            current = self._read(self._empty(owner, anchor))
            if current.revision and current.body_md == body_md:
                if current.status == "failed":
                    current.status = "queued"
                    current.attempts = 0
                    current.error = None
                    current.run_after = now() + timedelta(seconds=self.delay_seconds)
                    self._write(current)
                return current
            if expected_revision != current.revision:
                raise RevisionConflict("Note changed; read its current revision before editing")
            saved = PageNote(
                id=current.id,
                anchor=anchor,
                owner=owner,
                body_md=body_md,
                revision=current.revision + 1,
                content_hash=text_hash(body_md),
                cognified_revision=current.cognified_revision,
                status="queued",
                updated_at=now(),
                run_after=now() + timedelta(seconds=self.delay_seconds),
            )
            self._write(saved)
            return saved

    async def cognify_pending(self, ingest) -> bool:
        pending = await asyncio.to_thread(self.claim_pending)
        if pending is None:
            return False
        try:
            await ingest(pending)
        except Exception:
            await asyncio.to_thread(self.finish, pending, failed=True)
        else:
            await asyncio.to_thread(self.finish, pending)
        return True

    def recover(self) -> None:
        with self.lock:
            for path in self.root.glob("*.json"):
                note = PageNote.model_validate_json(path.read_bytes())
                if note.status == "cognifying":
                    note.status = "queued"
                    note.attempts = max(0, note.attempts - 1)
                    note.run_after = now()
                    self._write(note)

    def claim_pending(self) -> PageNote | None:
        with self.lock:
            for path in sorted(self.root.glob("*.json")):
                note = PageNote.model_validate_json(path.read_bytes())
                if (
                    note.status in {"queued", "failed"}
                    and note.attempts < 3
                    and note.run_after is not None
                    and note.run_after <= now()
                ):
                    note.status = "cognifying"
                    note.attempts += 1
                    self._write(note)
                    return note
        return None

    def finish(self, completed: PageNote, *, failed: bool = False) -> None:
        with self.lock:
            current = self._read(completed)
            if current.revision != completed.revision:
                return
            current.status = "failed" if failed else "ready"
            current.error = "Cognify failed; retry by saving this Note again" if failed else None
            current.run_after = now() + timedelta(seconds=30 * current.attempts) if failed else None
            if not failed:
                current.cognified_revision = completed.revision
            self._write(current)
