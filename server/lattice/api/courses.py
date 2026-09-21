from fastapi import APIRouter
from pydantic import BaseModel

from lattice.api.deps import COURSE_CODE, CurrentEmail, RegistryDep, SettingsDep
from lattice.api.materials import known_materials
from lattice.config import Settings
from lattice.registry import Registry

router = APIRouter(prefix="/courses", tags=["courses"])


class CourseSummary(BaseModel):
    code: str
    material_count: int
    note_count: int
    pending_count: int


@router.get("")
async def list_courses(
    email: CurrentEmail,
    registry: RegistryDep,
    settings: SettingsDep,
) -> list[CourseSummary]:
    return [
        _summary(code, email, registry, settings)
        for code in sorted(_known_courses(registry, settings))
    ]


def _summary(course: str, email: str, registry: Registry, settings: Settings) -> CourseSummary:
    materials = known_materials(course, registry, settings)
    return CourseSummary(
        code=course,
        material_count=len(materials),
        note_count=len(registry.list_notes(course, email)),
        pending_count=sum(1 for m in materials if m.status in ("queued", "cognifying")),
    )


def _known_courses(registry: Registry, settings: Settings) -> set[str]:
    codes = {c for c, _ in registry.materials}
    codes |= {c for c, _, _ in registry.notes}
    codes |= {s.course for s in registry.sessions.values()}
    uploads = settings.uploads_dir
    if uploads.is_dir():
        codes |= {p.name for p in uploads.iterdir() if p.is_dir() and COURSE_CODE.match(p.name)}
    return codes
