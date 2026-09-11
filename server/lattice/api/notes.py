from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Path
from pydantic import BaseModel, Field

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep, SettingsDep
from lattice.engine import Engine
from lattice.registry import Note, set_status

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
    background.add_task(_ingest, engine, note, target)
    return note


async def _ingest(engine: Engine, note: Note, path) -> None:
    set_status(note, "cognifying")
    try:
        user = await engine.principal(note.owner)
        _, private = await engine.enrol(note.course, user)
        await engine.replace(private, user, path.resolve())
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
        set_status(note, "failed", f"{type(exc).__name__}: {exc}")
        return
    set_status(note, "ready")
