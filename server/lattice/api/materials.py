from pathlib import PurePosixPath
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep, SettingsDep
from lattice.config import Settings
from lattice.engine import Engine
from lattice.registry import Material, Registry, set_status

router = APIRouter(prefix="/courses/{course}/materials", tags=["materials"])

ALLOWED_SUFFIXES = {".pdf", ".pptx", ".md", ".txt"}


@router.get("")
async def list_materials(
    course: CourseCode,
    _: CurrentEmail,
    registry: RegistryDep,
    settings: SettingsDep,
) -> list[Material]:
    return known_materials(course, registry, settings)


def known_materials(course: str, registry: Registry, settings: Settings) -> list[Material]:
    """Registry entries plus files left on disk by earlier runs.

    The registry is in-memory, so after a restart uploads are still on disk and
    still searchable in Cognee but have no record; they are listed as ready.
    """
    materials = registry.list_materials(course)
    seen = {m.filename for m in materials}
    folder = settings.uploads_dir / course
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            if path.is_file() and not path.name.startswith(".") and path.name not in seen:
                materials.append(Material(course=course, filename=path.name, status="ready"))
    return materials


@router.get("/{filename}")
async def get_material(
    course: CourseCode,
    filename: str,
    _: CurrentEmail,
    settings: SettingsDep,
) -> FileResponse:
    if PurePosixPath(filename).name != filename:
        raise HTTPException(400, "filename must not contain path separators")
    folder = (settings.uploads_dir / course).resolve()
    path = (folder / filename).resolve()
    if path.parent != folder or not path.is_file():
        raise HTTPException(404, "no such material")
    return FileResponse(path, filename=filename)


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
