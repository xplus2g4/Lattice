from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Path
from pydantic import BaseModel, Field

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep, SettingsDep
from lattice.api.ingest import ingest
from lattice.registry import Note

router = APIRouter(prefix="/courses/{course}/notes", tags=["notes"])

NoteId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")]


class NoteBody(BaseModel):
    body_md: str = Field(min_length=1, max_length=50_000)


@router.get("")
async def list_notes(course: CourseCode, email: CurrentEmail, registry: RegistryDep) -> list[Note]:
    return registry.list_notes(course, email)


@router.put("/{note_id}", status_code=202)
async def save_note(
    course: CourseCode,
    note_id: NoteId,
    email: CurrentEmail,
    body: NoteBody,
    background: BackgroundTasks,
    engine: EngineDep,
    registry: RegistryDep,
    settings: SettingsDep,
) -> Note:
    user = await engine.principal(email)
    target = settings.uploads_dir / course / "notes" / str(user.id) / f"{note_id}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.body_md)

    note = registry.upsert_note(course, email, note_id, body.body_md)
    background.add_task(ingest, engine, note, target)
    return note
