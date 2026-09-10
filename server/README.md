# server

Backend (API and Worker) for the course knowledge store. Python 3.14, FastAPI, managed with [uv](https://docs.astral.sh/uv/).

```sh
uv sync                                   # installs Python 3.14 and dependencies into .venv
uv run uvicorn lattice.main:app --reload  # http://localhost:8000, docs at /docs
uv run pytest
uv run ruff check . && uv run ruff format .
```

Configuration comes from the environment; copy `.env.example` to `.env` for local overrides.

Layout: `lattice/main.py` builds the FastAPI app (`create_app`), `lattice/config.py` holds settings, `lattice/api/` holds routers. See [docs/wiki/components.md](../docs/wiki/components.md) for what the API and Worker own.
