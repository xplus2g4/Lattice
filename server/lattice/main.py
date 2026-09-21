from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from lattice.api import (
    ask,
    courses,
    health,
    job_records,
    material_records,
    me,
    note_records,
    quiz_records,
)
from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.db.migrate import upgrade_async
from lattice.engine import Engine


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = Engine(settings)
    database = Database(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await engine.start()
        if settings.database_auto_migrate:
            await upgrade_async(settings.database_url)
        yield
        await database.dispose()

    app = FastAPI(title="Lattice API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.engine = engine
    app.state.database = database
    for router in (
        health.router,
        me.router,
        courses.router,
        material_records.router,
        note_records.router,
        ask.router,
        quiz_records.router,
        job_records.router,
    ):
        app.include_router(router)
    return app


app = create_app()
