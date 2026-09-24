"""Write the API's OpenAPI document to contracts/openapi.json.

The spec is the frozen contract (ADR 0005): the web app's types are generated from it, so
it is committed and CI runs this with --check to fail when a model changes without the
spec being regenerated.

    uv run python scripts/export_openapi.py
    uv run python scripts/export_openapi.py --check
"""

import argparse
import difflib
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = REPO_ROOT / "contracts" / "openapi.json"


def render() -> str:
    """The document as it belongs on disk: deterministic, and independent of the environment."""
    # Building the app constructs the Engine, which mkdirs its Cognee root as a side effect.
    # Point it at a temporary directory so exporting never touches a real `.cognee/`, and
    # skip `.env` so a developer's local settings cannot leak into the committed contract.
    with tempfile.TemporaryDirectory() as tmp:
        from lattice.config import Settings
        from lattice.main import create_app

        app = create_app(Settings(_env_file=None, cognee_root=Path(tmp)))
        return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the committed spec differs, instead of writing it",
    )
    args = parser.parse_args()
    relative = SPEC.relative_to(REPO_ROOT).as_posix()
    current = render()

    if not args.check:
        SPEC.parent.mkdir(parents=True, exist_ok=True)
        SPEC.write_text(current, encoding="utf-8", newline="\n")
        print(f"wrote {relative}")
        return 0

    committed = SPEC.read_text(encoding="utf-8") if SPEC.exists() else ""
    if committed == current:
        print(f"{relative} is up to date")
        return 0

    diff = difflib.unified_diff(
        committed.splitlines(keepends=True),
        current.splitlines(keepends=True),
        fromfile=f"{relative} (committed)",
        tofile=f"{relative} (generated)",
    )
    sys.stderr.writelines(diff)
    sys.stderr.write(
        f"\n{relative} is stale. Run `uv run python scripts/export_openapi.py`, then "
        "`npm run generate-api` in app/, and commit both.\n"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
