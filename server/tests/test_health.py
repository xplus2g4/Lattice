from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient

from lattice.api.deps import SessionDep, get_session
from lattice.config import Settings
from lattice.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_transaction_finishes_before_background_ingest():
    events = []
    app = FastAPI()

    async def transaction():
        yield None
        events.append("commit")

    app.dependency_overrides[get_session] = transaction

    @app.post("/save")
    async def save(background: BackgroundTasks, db: SessionDep):
        background.add_task(events.append, "ingest")
        return {"saved": True}

    assert TestClient(app).post("/save").status_code == 200
    assert events == ["commit", "ingest"]
