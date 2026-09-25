"""Telemetry: the process's own counters, histograms and gauges, served at `/metrics`.

One registry of our own rather than prometheus-client's global default, so tests can build
the app as often as they like without a duplicate-metric error. Labels never name a user:
Telemetry is operator data, not a Product event. Nothing else imports `prometheus_client`.
"""

import time

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

REGISTRY = CollectorRegistry()
CONTENT_TYPE = CONTENT_TYPE_LATEST

HTTP_BUCKETS = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
# Ask and Cognify wait on an LLM; the tail is minutes, not milliseconds.
SLOW_BUCKETS = (0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600)
REFRESH_BUCKETS = (1, 5, 15, 30, 60, 300, 900, 1800, 3600)

HTTP_REQUESTS = Counter(
    "http_requests",
    "Requests served, by matched route template and status code.",
    ["route", "status"],
    registry=REGISTRY,
)
HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "Time to send the response, by matched route template.",
    ["route"],
    buckets=HTTP_BUCKETS,
    registry=REGISTRY,
)

ASK_DURATION = Histogram(
    "ask_duration_seconds",
    "Time one search lane of `/ask` took.",
    ["course", "lane"],
    buckets=SLOW_BUCKETS,
    registry=REGISTRY,
)
ASK_OUTCOME = Counter(
    "ask_outcome",
    "How each `/ask` ended: answered, empty_answer, engine_error or refused_budget.",
    ["course", "outcome"],
    registry=REGISTRY,
)
ASK_CITATIONS = Histogram(
    "ask_citations",
    "Chunks cited per answer; the first quality signal, recorded from day one.",
    ["course"],
    buckets=(0, 1, 2, 3, 5, 8, 13, 21),
    registry=REGISTRY,
)

COGNIFY_DURATION = Histogram(
    "cognify_duration_seconds",
    "Time Cognify took for one Material or Note.",
    ["course", "kind"],
    buckets=SLOW_BUCKETS,
    registry=REGISTRY,
)
COGNIFY_OUTCOME = Counter(
    "cognify_outcome",
    "How each Cognify ended: ready, failed or retried.",
    ["course", "kind", "outcome"],
    registry=REGISTRY,
)
INGEST_QUEUE_OLDEST = Gauge(
    "ingest_queue_oldest_seconds",
    "Age of the oldest Material or Note still waiting on ingest.",
    ["kind"],
    registry=REGISTRY,
)
INGEST_QUEUE_DEPTH = Gauge(
    "ingest_queue_depth",
    "Materials and Notes per ingest status.",
    ["kind", "status"],
    registry=REGISTRY,
)

LLM_CALLS = Counter(
    "llm_calls",
    "Provider attempts by kind (completion, embedding), model and outcome.",
    ["kind", "model", "outcome"],
    registry=REGISTRY,
)
LLM_TOKENS = Counter(
    "llm_tokens",
    "Tokens by kind, model and direction (prompt, completion, cached).",
    ["kind", "model", "direction"],
    registry=REGISTRY,
)
SPEND_USD = Counter(
    "spend_usd",
    "Spend in USD by kind, model and course, from the configured price table.",
    ["kind", "model", "course"],
    registry=REGISTRY,
)

COURSE_SUMMARY_REFRESH = Histogram(
    "course_summary_refresh_seconds",
    "Time one pass over every course's summary took.",
    buckets=REFRESH_BUCKETS,
    registry=REGISTRY,
)
LOOP_LAST_TICK = Gauge(
    "loop_last_tick_timestamp",
    "Wall-clock time of the last iteration of each in-process loop.",
    ["loop"],
    registry=REGISTRY,
)

_last_ticks: dict[str, float] = {}


def heartbeat(loop: str) -> None:
    """Record that `loop` (ingest, summaries, watchdog) completed an iteration just now."""
    now = time.time()
    _last_ticks[loop] = now
    LOOP_LAST_TICK.labels(loop=loop).set(now)


def last_tick(loop: str) -> float | None:
    """When `loop` last ticked, as wall-clock seconds; None before its first iteration."""
    return _last_ticks.get(loop)


def render() -> bytes:
    """The registry in Prometheus text exposition format, for `/metrics`."""
    return generate_latest(REGISTRY)
