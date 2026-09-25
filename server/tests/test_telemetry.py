"""Request ids, the `/metrics` gate, and the 502 body that names its request."""

import json
import logging

from httpx import AsyncClient

from lattice.logging import JsonFormatter, RequestIdFilter, request_id
from tests.test_materials import join


async def test_every_response_carries_a_request_id(client: AsyncClient) -> None:
    generated = await client.get("/health")
    assert generated.status_code == 200
    assert len(generated.headers["x-request-id"]) == 16

    echoed = await client.get("/health", headers={"X-Request-Id": "trace-abc"})
    assert echoed.headers["x-request-id"] == "trace-abc"


async def test_an_unmatched_path_still_gets_a_request_id(client: AsyncClient) -> None:
    response = await client.get("/no-such-route")
    assert response.status_code == 404
    assert response.headers["x-request-id"]


async def test_metrics_are_hidden_until_a_token_is_configured(client: AsyncClient) -> None:
    assert (await client.get("/metrics")).status_code == 404
    assert (
        await client.get("/metrics", headers={"Authorization": "Bearer anything"})
    ).status_code == 404


async def test_metrics_want_the_configured_bearer(client: AsyncClient, settings) -> None:
    settings.metrics_token = "s3cret"

    assert (await client.get("/metrics")).status_code == 401
    wrong = await client.get("/metrics", headers={"Authorization": "Bearer nope"})
    assert wrong.status_code == 401

    right = await client.get("/metrics", headers={"Authorization": "Bearer s3cret"})
    assert right.status_code == 200
    assert right.headers["content-type"].startswith("text/plain")
    body = right.text
    assert "http_requests_total" in body
    # The 401s above were counted against the route template, not the raw path.
    assert 'http_requests_total{route="/metrics",status="401"} 2.0' in body


async def test_an_engine_error_names_its_request(student: AsyncClient, engine) -> None:
    await join(student)
    engine.fail_with = RuntimeError("cognee is down")
    lines: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = lines.append
    handler.addFilter(RequestIdFilter())
    log = logging.getLogger("lattice.api.ask")
    log.addHandler(handler)
    try:
        response = await student.post("/ask", json={"course": "cs3216", "question": "hello"})
    finally:
        log.removeHandler(handler)

    assert response.status_code == 502
    body = response.json()
    assert body["detail"] == "RuntimeError: cognee is down"
    assert body["request_id"] == response.headers["x-request-id"]
    # The log line written while serving the request carries the same id.
    assert [line.request_id for line in lines] == [body["request_id"]]


def test_log_lines_are_one_json_object_each() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("lattice.x", logging.WARNING, __file__, 1, "hi %s", ("there",), None)
    token = request_id.set("req-1")
    try:
        RequestIdFilter().filter(record)
    finally:
        request_id.reset(token)
    line = json.loads(formatter.format(record))
    assert line["msg"] == "hi there"
    assert line["level"] == "WARNING"
    assert line["request_id"] == "req-1"
    assert line["ts"].endswith("+00:00")
    assert "exc" not in line
