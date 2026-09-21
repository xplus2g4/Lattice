from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from lattice.api import ask, courses, health, materials, notes
from lattice.config import Settings, get_settings
from lattice.engine import Engine
from lattice.registry import Registry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = Engine(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await engine.start()
        yield

    app = FastAPI(title="Lattice API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.engine = engine
    app.state.registry = Registry()
    for router in (health.router, courses.router, materials.router, notes.router, ask.router):
        app.include_router(router)
    return app


app = create_app()
