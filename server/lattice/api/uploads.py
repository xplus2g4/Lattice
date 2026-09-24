"""One multipart file, checked and hashed: what Material and Note uploads share."""

import hashlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from fastapi import HTTPException, UploadFile


@dataclass(frozen=True)
class Received:
    filename: str
    suffix: str
    sha256: str
    body: bytes

    def store(self, directory: Path) -> Path:
        """Content-addressed: the bytes land as <sha256><suffix> under `directory`."""
        target = directory / f"{self.sha256}{self.suffix}"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.body)
        return target


async def receive(file: UploadFile, *, allowed: set[str], max_mb: int) -> Received:
    """415 on a suffix outside `allowed`, 413 past `max_mb`. The body is read once, here."""
    filename = PurePosixPath(file.filename or "").name
    suffix = PurePosixPath(filename).suffix.lower()
    if not filename or suffix not in allowed:
        raise HTTPException(415, f"accepted: {', '.join(sorted(allowed))}")
    limit = max_mb * 1024 * 1024
    body = await file.read(limit + 1)
    if len(body) > limit:
        raise HTTPException(413, f"max {max_mb} MB")
    return Received(filename, suffix, hashlib.sha256(body).hexdigest(), body)
