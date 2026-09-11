from pathlib import PurePosixPath
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep, SettingsDep
from lattice.engine import Engine
from lattice.registry import Material, set_status

router = APIRouter(prefix="/courses/{course}/materials", tags=["materials"])

ALLOWED_SUFFIXES = {".pdf", ".pptx", ".md", ".txt"}


@router.get("")
async def list_materials(
    course: CourseCode, _: CurrentEmail, registry: RegistryDep
) -> list[Material]:
    return registry.list_materials(course)


@router.post("", status_code=202)
async def upload_material(
    course: CourseCode,
    email: CurrentEmail,
    file: Annotated[UploadFile, File()],
    background: BackgroundTasks,
    engine: EngineDep,
    registry: RegistryDep,
    settings: SettingsDep,
) -> Material:
    filename = PurePosixPath(file.filename or "").name
    if not filename or PurePosixPath(filename).suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(415, f"accepted: {', '.join(sorted(ALLOWED_SUFFIXES))}")

    limit = settings.max_upload_mb * 1024 * 1024
    body = await file.read(limit + 1)
    if len(body) > limit:
        raise HTTPException(413, f"max {settings.max_upload_mb} MB")

    target = settings.uploads_dir / course / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)

    await engine.principal(email)
    material = registry.upsert_material(course, filename)
    background.add_task(_ingest, engine, material, target)
    return material


async def _ingest(engine: Engine, material: Material, path) -> None:
    set_status(material, "cognifying")
    try:
        dataset = await engine.global_dataset(material.course)
        await engine.replace(dataset, await engine.instructor(), path.resolve())
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
        set_status(material, "failed", f"{type(exc).__name__}: {exc}")
        return
    set_status(material, "ready")
