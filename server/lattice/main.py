import asyncio
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from filelock import FileLock

from lattice.api import (
    admin,
    ask,
    auth,
    courses,
    health,
    material_records,
    me,
    note_records,
    quiz_records,
)
from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.db.migrate import upgrade_async
from lattice.engine import Engine
from lattice.ingest import Ingest


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    if settings.mcp_enabled and not settings.dev_header_auth:
        raise ValueError(
            "MCP currently requires development header identity and loopback-only access"
        )
    engine = Engine(settings)
    database = Database(settings)

    async def ingest_notes():
        while True:
            if not await app.state.ingest.cognify_pending():
                await asyncio.sleep(1)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            await app.state.engine.start()
            if settings.database_auto_migrate:
                await upgrade_async(settings.database_url)
            with FileLock(settings.cognee_root.resolve() / "note-ingest.lock", timeout=0):
                await app.state.ingest.recover_notes()
                async with AsyncExitStack() as stack:
                    if settings.mcp_enabled:
                        await stack.enter_async_context(mcp.session_manager.run())
                    async with asyncio.TaskGroup() as workers:
                        task = workers.create_task(ingest_notes())
                        try:
                            yield
                        finally:
                            task.cancel()
        finally:
            await database.dispose()

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
    app.state.database = database
    app.state.ingest = Ingest(database.sessionmaker, engine, settings)
    for router in (
        health.router,
        auth.router,
        admin.router,
        me.router,
        courses.router,
        material_records.router,
        note_records.router,
        ask.router,
        quiz_records.router,
    ):
        app.include_router(router)
    if settings.mcp_enabled:
        from lattice.mcp import LocalMCP, create_mcp

        mcp = create_mcp(app, settings)
        app.state.mcp = mcp
        app.mount("/mcp", LocalMCP(mcp.streamable_http_app(), settings))
    return app


app = create_app()
