import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from filelock import FileLock

from lattice.api import ask, health, materials, notes
from lattice.config import Settings, get_settings
from lattice.engine import Engine
from lattice.registry import Registry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    if settings.mcp_enabled and not settings.dev_header_auth:
        raise ValueError(
            "MCP currently requires development header identity and loopback-only access"
        )
    engine = Engine(settings)

    async def ingest_notes():
        while True:
            if not await page_notes.cognify_pending(app.state.engine.cognify_note):
                await asyncio.sleep(1)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await app.state.engine.start()
        if not settings.mcp_enabled:
            yield
            return
        with FileLock(page_notes.root / "worker.lock", timeout=0):
            await asyncio.to_thread(page_notes.recover)
            async with mcp.session_manager.run(), asyncio.TaskGroup() as workers:
                task = workers.create_task(ingest_notes())
                try:
                    yield
                finally:
                    task.cancel()

    app = FastAPI(title="Lattice API", lifespan=lifespan)
    app.dependency_overrides[get_settings] = lambda: settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.engine = engine
    app.state.registry = Registry()
    for router in (health.router, materials.router, notes.router, ask.router):
        app.include_router(router)
    if settings.mcp_enabled:
        from lattice.mcp import LocalMCP, create_mcp
        from lattice.page_notes import PageNotes

        page_notes = PageNotes(settings.uploads_dir, max_bytes=settings.max_upload_mb * 1024**2)
        mcp = create_mcp(app, page_notes)
        app.state.page_notes = page_notes
        app.state.mcp = mcp
        app.mount("/mcp", LocalMCP(mcp.streamable_http_app(), settings))
    return app


app = create_app()
