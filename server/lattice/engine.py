"""The Cognee seam: everything above this module speaks in principals, datasets and tiers.

Stage 2 (pgvector plus an own concept graph) replaces this module and nothing above it.
"""

import secrets
from pathlib import Path
from typing import Any
from uuid import UUID

import cognee
from cognee.infrastructure.databases.relational import create_db_and_tables
from cognee.modules.data.methods import (
    create_authorized_dataset,
    get_authorized_dataset_by_name,
    get_dataset_data,
    has_dataset_data,
)
from cognee.modules.data.models import Dataset
from cognee.modules.retrieval.exceptions.exceptions import NoDataError
from cognee.modules.search.types import SearchType
from cognee.modules.users.methods import create_user, get_user_by_email
from cognee.modules.users.models import User
from cognee.modules.users.permissions.methods import give_permission_on_dataset

from lattice.config import Settings
from lattice.registry import Evidence, TierResult
from lattice.retrieval import GROUNDING_POLICY, install_retrievers

QUERY_TYPES = ("GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS")


class IsolationError(RuntimeError):
    """A result or citation came from a dataset the caller may not read.

    ADR 0002's second enforcement layer. Cognee's own dataset permissions should make this
    unreachable; if it fires, something beneath the API is wrong and no part of the answer
    can be trusted, so `/ask` fails with a 502 rather than returning a filtered version.
    Exercised by `tests/test_canary.py::test_private_notes_never_leak`.
    """


class Engine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        install_retrievers()
        root = settings.cognee_root.resolve()
        for sub in ("system/databases", "data"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        cognee.config.system_root_directory(str(root / "system"))
        cognee.config.data_root_directory(str(root / "data"))
        self._principals: dict[str, User] = {}
        self._datasets: dict[tuple[str, UUID], Dataset] = {}
        self._enrolled: set[tuple[UUID, str]] = set()

    async def start(self) -> None:
        """Create Cognee's relational schema if this is a fresh root. Idempotent."""
        await create_db_and_tables()

    # Identity

    async def principal(self, email: str) -> User:
        """The engine identity for an app user; created on first sight."""
        user = self._principals.get(email)
        if user is None:
            user = await get_user_by_email(email)
            if user is None:
                user = await create_user(email, secrets.token_urlsafe(32), is_verified=True)
            self._principals[email] = user
        return user

    async def instructor(self) -> User:
        return await self.principal(self.settings.instructor_email)

    # Datasets

    async def _dataset(self, name: str, owner: User) -> Dataset:
        key = (name, owner.id)
        dataset = self._datasets.get(key)
        if dataset is None:
            dataset = await get_authorized_dataset_by_name(name, owner, "write")
            if dataset is None:
                dataset = await create_authorized_dataset(name, owner)
            self._datasets[key] = dataset
        return dataset

    async def global_dataset(self, course: str) -> Dataset:
        return await self._dataset(f"{course}-global", await self.instructor())

    async def private_dataset(self, course: str, user: User) -> Dataset:
        return await self._dataset(f"{course}-user-{user.id}", user)

    async def enrol(self, course: str, user: User) -> tuple[Dataset, Dataset]:
        """Grant read on the course's global dataset and ensure the user's private one."""
        global_ds = await self.global_dataset(course)
        private_ds = await self.private_dataset(course, user)
        if (user.id, course) not in self._enrolled:
            await give_permission_on_dataset(user, global_ds.id, "read")
            self._enrolled.add((user.id, course))
        return global_ds, private_ds

    # Ingest

    async def replace(self, dataset: Dataset, user: User, path: Path) -> None:
        """Drop any earlier data with this file's name, then add and cognify."""
        for data in await get_dataset_data(dataset.id):
            if data.name in (path.name, path.stem):
                await cognee.datasets.delete_data(dataset.id, data.id, user=user, mode="hard")
        await cognee.add(str(path), dataset_id=dataset.id, user=user)
        await cognee.cognify(datasets=[dataset.id], user=user)

    # Retrieval

    async def search(
        self,
        user: User,
        datasets: dict[UUID, str],
        question: str,
        query_type: str,
        session_id: str,
    ) -> list[TierResult]:
        """One call across every non-empty dataset; Cognee returns one completion per dataset.

        A dataset with nothing cognified makes the whole call raise `NoDataError` (observed:
        a fresh private dataset before the first note), so empty datasets are left out.
        """
        searchable = [d for d in datasets if await has_dataset_data(d)]
        if not searchable:
            return []
        try:
            raw = await cognee.search(
                question,
                query_type=SearchType[query_type],
                user=user,
                dataset_ids=searchable,
                session_id=session_id,
                system_prompt=GROUNDING_POLICY,
                verbose=True,
                include_references=True,
            )
        except NoDataError:
            # Data added but cognify not finished, or it failed. Nothing to answer from yet.
            return []
        return [_tier_result(r, datasets) for r in raw]


def _dataset_uuid(value: Any) -> UUID | None:
    """Cognee gives `dataset_id` as a UUID on results and as a string on evidence."""
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except AttributeError, TypeError, ValueError:
        return None


def _tier_result(raw: dict[str, Any], datasets: dict[UUID, str]) -> TierResult:
    """One Cognee per-dataset result, refused unless it came from a dataset the caller read.

    There is deliberately no default tier here: an unrecognised `dataset_id` used to be
    labelled `course` and passed on, which would launder another principal's answer into
    the shared tier instead of rejecting it.

    Refusing a missing `dataset_id` is safe rather than brittle because `search` always
    passes `dataset_ids`, and Cognee fills the field from the dataset it fanned out to
    (`get_retriever_output`: `dataset.id if dataset else None`). The `None` branch belongs
    to its no-dataset-context path, which this engine never takes; a result arriving from
    it could not be attributed to a tier anyway.
    """
    dataset_id = _dataset_uuid(raw.get("dataset_id"))
    if dataset_id not in datasets:
        raise IsolationError(f"result from dataset {raw.get('dataset_id')!r}, not the caller's")
    return TierResult(
        tier=datasets[dataset_id],  # type: ignore[arg-type]
        dataset_name=raw.get("dataset_name") or "",
        answer=_answer_text(raw.get("text_result")),
        evidence=_dedupe_evidence(raw.get("evidence") or [], datasets),
    )


def _answer_text(text: Any) -> str | None:
    """Completion types return a string; CHUNKS returns chunk dicts whose `text` is the payload."""
    if text is None or isinstance(text, str):
        return text
    if isinstance(text, list):
        parts = [t.get("text", str(t)) if isinstance(t, dict) else str(t) for t in text]
        return "\n\n".join(parts)
    return str(text)


def _dedupe_evidence(items: list[dict[str, Any]], datasets: dict[UUID, str]) -> list[Evidence]:
    """Cognee lists a segment once per graph edge citing it; keep one entry per artifact.

    Every citation that names a dataset must name one the caller may read (ADR 0002). Graph
    nodes and edges carry no `dataset_id`; they are covered by the check on the result they
    arrived in, whose dataset is verified in `_tier_result`.
    """
    seen: set[str] = set()
    out: list[Evidence] = []
    for item in items:
        named = item.get("dataset_id")
        if named is not None and _dataset_uuid(named) not in datasets:
            raise IsolationError(f"citation from dataset {named!r}, not the caller's")
        key = f"{item.get('kind')}:{item.get('artifact_id')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(Evidence.model_validate(item))
    return out
