from fastapi.testclient import TestClient

from lattice.config import Settings
from lattice.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
