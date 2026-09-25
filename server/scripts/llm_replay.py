"""Local OpenAI-compatible stand-in for the LLM, for BENCH-0001 (docs/benchmarks/0001).

`record` forwards each chat completion to the real provider, charges the spend against a hard
cap, and keeps every successful response keyed by a hash of the request. `replay` answers the
same prompts from that store at zero latency, so a run with the LLM's time removed is the floor
the live arms are compared against. A prompt the store has never seen is answered 500 and
counted: it would mean the two arms did not send the same prompts, which invalidates the floor.

Both modes expose per-run statistics (`/bench/begin`, `/bench/stats`) that the harness records.
"""

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_runtime import BudgetLedger  # noqa: E402 - the verified DeepSeek cost formula

# What makes two requests "the same prompt". Anything litellm varies per call (stream flags,
# request ids) is left out on purpose.
KEY_FIELDS = ("model", "messages", "response_format", "temperature", "tools")


def request_key(body: dict) -> str:
    subset = {field: body.get(field) for field in KEY_FIELDS}
    return hashlib.sha256(json.dumps(subset, sort_keys=True).encode()).hexdigest()


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, body TEXT)")

    def get(self, key: str) -> str | None:
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT body FROM responses WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def put(self, key: str, body: str) -> None:
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("INSERT OR REPLACE INTO responses VALUES (?, ?)", (key, body))

    def count(self) -> int:
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute("SELECT count(*) FROM responses").fetchone()[0]


class RunStats:
    """Everything the harness wants to know about one run's LLM traffic."""

    def __init__(self) -> None:
        self.requests = 0
        self.statuses: dict[str, int] = {}
        self.misses = 0
        self.refused = 0
        self.in_flight = 0
        self.max_in_flight = 0
        self.latencies: list[float] = []
        self.spend_micro = 0
        self.tokens_in = 0
        self.tokens_out = 0

    def as_dict(self) -> dict:
        return {
            "requests": self.requests,
            "statuses": self.statuses,
            "replay_misses": self.misses,
            "refused_over_cap": self.refused,
            "max_in_flight": self.max_in_flight,
            "latencies_s": [round(x, 3) for x in self.latencies],
            "spend_usd": self.spend_micro / 1_000_000,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
        }


def build(mode: str, store: Store, upstream: str, cap_micro: int) -> FastAPI:
    app = FastAPI()
    state = {"run": RunStats(), "spent_micro": 0, "run_name": None}
    client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))

    @app.post("/bench/begin")
    async def begin(request: Request) -> dict:
        state["run"] = RunStats()
        state["run_name"] = (await request.json()).get("run")
        return {"run": state["run_name"], "recorded_prompts": store.count()}

    @app.get("/bench/stats")
    async def stats() -> dict:
        return {
            "run": state["run_name"],
            "mode": mode,
            "spent_usd_total": state["spent_micro"] / 1_000_000,
            "recorded_prompts": store.count(),
            **state["run"].as_dict(),
        }

    @app.post("/v1/chat/completions")
    async def completions(request: Request) -> Response:
        raw = await request.body()
        body = json.loads(raw)
        key = request_key(body)
        run: RunStats = state["run"]
        run.requests += 1
        run.in_flight += 1
        run.max_in_flight = max(run.max_in_flight, run.in_flight)
        started = time.monotonic()
        try:
            if mode == "replay":
                stored = store.get(key)
                if stored is None:
                    # Counted as a miss. The body is well-formed and empty: a plain-text call
                    # accepts it, so routing can be checked for free; a structured call fails
                    # validation on it, so a real run with a miss cannot pass unnoticed.
                    run.misses += 1
                    status, text = (
                        200,
                        json.dumps(
                            {
                                "id": "replay-miss",
                                "object": "chat.completion",
                                "created": 0,
                                "model": body.get("model"),
                                "choices": [
                                    {
                                        "index": 0,
                                        "message": {"role": "assistant", "content": "{}"},
                                        "finish_reason": "stop",
                                    }
                                ],
                                "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                            }
                        ),
                    )
                else:
                    status, text = 200, stored
            else:
                # Refuse once the settled spend plus a same-cost estimate for everything still in
                # flight would pass the cap. Not a worst-case reservation: that would starve the
                # batched arm, whose whole point is many requests at once.
                average = run.spend_micro // max(1, run.requests - run.in_flight)
                if state["spent_micro"] + average * run.in_flight > cap_micro:
                    run.refused += 1
                    status, text = 402, json.dumps({"error": "benchmark spend cap reached"})
                else:
                    headers = {
                        k: v
                        for k, v in request.headers.items()
                        if k.lower() in ("authorization", "content-type", "accept")
                    }
                    upstream_response = await client.post(
                        f"{upstream}/chat/completions", content=raw, headers=headers
                    )
                    status, text = upstream_response.status_code, upstream_response.text
                    if status == 200:
                        usage = upstream_response.json().get("usage") or {}
                        charge = BudgetLedger.cost_upper_bound(
                            int(usage.get("prompt_tokens", 0)),
                            int(usage.get("completion_tokens", 0)),
                        )
                        run.spend_micro += charge
                        state["spent_micro"] += charge
                        run.tokens_in += int(usage.get("prompt_tokens", 0))
                        run.tokens_out += int(usage.get("completion_tokens", 0))
                        store.put(key, text)
        finally:
            run.latencies.append(time.monotonic() - started)
            run.in_flight -= 1
        run.statuses[str(status)] = run.statuses.get(str(status), 0) + 1
        return Response(content=text, status_code=status, media_type="application/json")

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("record", "replay"), required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--upstream", default="", help="provider base URL ending in /v1 (record)")
    parser.add_argument("--cap-usd", type=float, default=4.0)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.mode == "record" and not args.upstream:
        parser.error("--upstream is required in record mode")
    app = build(args.mode, Store(args.store), args.upstream.rstrip("/"), int(args.cap_usd * 1e6))
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())
    main()
