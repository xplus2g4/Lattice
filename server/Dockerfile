FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /srv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-install-project
COPY lattice ./lattice
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked

ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8000
# The Worker runs from this same image with a different command.
CMD ["uvicorn", "lattice.main:app", "--host", "0.0.0.0", "--port", "8000"]
