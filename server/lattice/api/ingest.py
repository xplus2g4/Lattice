"""Shared ingest bookkeeping: status flips around an engine replace.

Materials go to the course's global dataset under the instructor principal;
notes go to the owner's private dataset.
"""

from pathlib import Path

from lattice.engine import Engine
from lattice.registry import Material, Note, set_status


async def ingest(engine: Engine, item: Material | Note, path: Path) -> None:
    set_status(item, "cognifying")
    try:
        if isinstance(item, Note):
            user = await engine.principal(item.owner)
            _, dataset = await engine.enrol(item.course, user)
            await engine.replace(dataset, user, path.resolve())
        else:
            dataset = await engine.global_dataset(item.course)
            await engine.replace(dataset, await engine.instructor(), path.resolve())
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
        set_status(item, "failed", f"{type(exc).__name__}: {exc}")
        return
    set_status(item, "ready")
