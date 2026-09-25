import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from filelock import FileLock

from lattice.api import (
    ask,
    courses,
    health,
    material_records,
    me,
    note_records,
    quiz_records,
    quizzes,
    study_tools,
)
from lattice.config import Settings, get_settings
from lattice.course_summaries import CourseSummaries
from lattice.db import Database
from lattice.db.migrate import upgrade_async
from lattice.engine import Engine
from lattice.ingest import Ingest


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
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
                async with asyncio.TaskGroup() as workers:
                    tasks = [
                        workers.create_task(ingest_notes()),
                        # Under the same lock as Note ingest, so one process refreshes.
                        workers.create_task(app.state.course_summaries.run_forever()),
                    ]
                    try:
                        yield
                    finally:
                        for task in tasks:
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
    app.state.course_summaries = CourseSummaries(database.sessionmaker, engine, settings)
    for router in (
        health.router,
        me.router,
        courses.router,
        material_records.router,
        note_records.router,
        ask.router,
        quiz_records.router,
        study_tools.router,
        quizzes.router,
    ):
        app.include_router(router)
    return app


app = create_app()
