"""Resolve retrieved Citations for display without changing the stored Turn audit."""

import re
from copy import deepcopy
from pathlib import PurePosixPath
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Material, Note, User

# Only remove Cognee's diagnostic appendix, never an ordinary prose Evidence section.
_ENGINE_APPENDIX = re.compile(
    r"\n\nEvidence:\n(?=- chunk (?:\d+|unknown) of document [^\n]+ "
    r"\((?:data_id|chunk_id):)[\s\S]*\Z"
)


def answer_text(value: str) -> str:
    return _ENGINE_APPENDIX.sub("", value).rstrip()


def _name(value: str) -> str:
    return PurePosixPath(value.replace("\\", "/")).name


class Citations:
    def __init__(self, materials: list[Material], notes: list[Note]):
        self.materials: dict[str, Material] = {}
        for material in materials:
            for name in (material.sha256, _name(material.storage_uri), material.filename):
                self.materials[name] = material
        self.notes = {str(note.id): note for note in notes}

    @classmethod
    async def load(cls, db: AsyncSession, user: User, course_id: UUID) -> Citations:
        materials = list(await db.scalars(select(Material).where(Material.course_id == course_id)))
        notes = list(
            await db.scalars(
                select(Note).where(Note.course_id == course_id, Note.user_id == user.id)
            )
        )
        return cls(materials, notes)

    def content(self, original: dict) -> dict:
        content = deepcopy(original)
        results = content.get("results")
        if not isinstance(results, list):
            return content
        for result in results:
            if isinstance(result.get("answer"), str):
                result["answer"] = answer_text(result["answer"])
            resolved = []
            for evidence in result.get("evidence", []):
                if evidence.get("kind") != "segment" or not evidence.get("chunk_id"):
                    continue
                name = _name(evidence.get("document_name") or "")
                if result.get("tier") == "course":
                    material = self.materials.get(name) or self.materials.get(
                        PurePosixPath(name).stem
                    )
                    if material is None:
                        continue
                    evidence.update(document_name=material.filename, material_id=str(material.id))
                elif result.get("tier") == "notes":
                    note = self.notes.get(PurePosixPath(name).stem)
                    if note is None:
                        continue
                    evidence.update(document_name=note.title, note_id=str(note.id), page=note.page)
                else:
                    continue
                resolved.append(evidence)
            result["evidence"] = resolved
        content["text"] = "\n\n".join(r["answer"] for r in results if r.get("answer"))
        return content
