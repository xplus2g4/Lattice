import asyncio
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from filelock import FileLock
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from lattice import telemetry
from lattice.api import (
    ask,
    courses,
    health,
    invites,
    material_records,
    me,
    metrics,
    note_records,
    quiz_records,
    quizzes,
    study_tools,
)
from lattice.api.deps import ApiError
from lattice.config import Settings, get_settings
from lattice.course_summaries import CourseSummaries
from lattice.db import Database
from lattice.db.migrate import upgrade_async
from lattice.engine import Engine
from lattice.ingest import Ingest
from lattice.logging import configure_logging, request_id
from lattice.telegram import Telegram
from lattice.watchdog import Watchdog


class RequestIdMiddleware:
    """Tags every request with an id, echoed as `X-Request-Id` and carried by every log line
    written while serving it, and records the request in Telemetry by route template."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        rid = headers.get(b"x-request-id", b"").decode("latin-1") or uuid4().hex[:16]
        status = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [*message.get("headers", []), (b"x-request-id", rid.encode())]
            await send(message)

        token = request_id.set(rid)
        started = time.perf_counter()
        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id.reset(token)
            route = scope.get("route")
            label = route.path if route is not None else "unmatched"
            telemetry.HTTP_REQUESTS.labels(route=label, status=str(status)).inc()
            telemetry.HTTP_REQUEST_DURATION.labels(route=label).observe(
                time.perf_counter() - started
            )


async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body, status_code=exc.status_code, headers=exc.headers)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    engine = Engine(settings)
    database = Database(settings)

    async def ingest_notes():
        while True:
            telemetry.heartbeat("ingest")
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
                # Materials have no polling loop yet: whatever the last process left mid-ingest
                # is scheduled again here and takes its turn exactly as a fresh upload would.
                recovered = await app.state.ingest.recover_materials()
                async with asyncio.TaskGroup() as workers:
                    tasks = [
                        workers.create_task(ingest_notes()),
                        # Under the same lock as Note ingest, so one process refreshes.
                        workers.create_task(app.state.course_summaries.run_forever()),
                        workers.create_task(app.state.watchdog.run_forever()),
                    ]
                    for material_id in recovered:
                        workers.create_task(app.state.ingest.material(material_id))
                    try:
                        yield
                    finally:
                        for task in tasks:
                            task.cancel()
        finally:
            await database.dispose()

    app = FastAPI(title="Lattice API", lifespan=lifespan)
    app.dependency_overrides[get_settings] = lambda: settings
    app.add_exception_handler(ApiError, api_error)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Added last, so it is outermost: preflights and unmatched paths get an id too.
    app.add_middleware(RequestIdMiddleware)
    app.state.engine = engine
    app.state.database = database
    app.state.ingest = Ingest(database.sessionmaker, engine, settings)
    app.state.course_summaries = CourseSummaries(database.sessionmaker, engine, settings)
    app.state.telegram = Telegram(settings)
    app.state.watchdog = Watchdog(database.sessionmaker, settings, app.state.telegram)
    for router in (
        health.router,
        metrics.router,
        me.router,
        invites.router,
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
