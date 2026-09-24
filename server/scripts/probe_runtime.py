import argparse
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import httpx

PRICING = "https://api-docs.deepseek.com/quick_start/pricing"
RATE_VERSION = "deepseek-flash-2026-09-20-peak-upper-bound"
MODELS = {"deepseek-flash", "deepseek-v4-flash"}
CONTEXT_LIMIT = 1_048_576
OUTPUT_LIMIT = 393_216
SERVER_ROOT = Path(__file__).resolve().parents[1]


class BudgetExceeded(RuntimeError):
    pass


class BudgetLedger:
    def __init__(self, path: Path, limit_usd: Decimal):
        if not limit_usd.is_finite() or not 0 < limit_usd <= 2:
            raise ValueError("The experiment limit must be positive and at most US$2.")
        self.path = path
        self.limit = int(limit_usd * 1_000_000)
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS budget ("
                "id INTEGER PRIMARY KEY CHECK(id=1), limit_micro INTEGER, rate_version TEXT)"
            )
            db.execute("INSERT OR IGNORE INTO budget VALUES (1, ?, ?)", (self.limit, RATE_VERSION))
            existing = db.execute(
                "SELECT limit_micro, rate_version FROM budget WHERE id=1"
            ).fetchone()
            if existing != (self.limit, RATE_VERSION):
                raise ValueError("Reuse the ledger's original limit and verified pricing version.")
            db.execute(
                "CREATE TABLE IF NOT EXISTS requests ("
                "id INTEGER PRIMARY KEY, started_at TEXT, model TEXT, output_limit INTEGER, "
                "charge_micro INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER, "
                "cache_hit_tokens INTEGER, reported_model TEXT, outcome TEXT)"
            )

    @staticmethod
    def cost_upper_bound(prompt_tokens: int, completion_tokens: int) -> int:
        return (prompt_tokens * 3 + completion_tokens * 12 + 9) // 10

    def reserve(self, body: dict) -> int:
        if body.get("model") not in MODELS or body.get("stream") or body.get("n", 1) != 1:
            raise BudgetExceeded(
                "Only single, non-streaming DeepSeek Flash completions are allowed."
            )
        output_limit = body.get("max_completion_tokens", body.get("max_tokens", OUTPUT_LIMIT))
        if type(output_limit) is not int or not 0 < output_limit <= OUTPUT_LIMIT:
            raise BudgetExceeded("Unknown output-token bound; request was not sent.")
        reservation = self.cost_upper_bound(CONTEXT_LIMIT, output_limit)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            used = db.execute("SELECT COALESCE(SUM(charge_micro), 0) FROM requests").fetchone()[0]
            if used + reservation > self.limit:
                raise BudgetExceeded(
                    "Remaining budget cannot cover this request's worst-case cost."
                )
            row = db.execute(
                "INSERT INTO requests (started_at, model, output_limit, charge_micro, outcome) "
                "VALUES (?, ?, ?, ?, 'reserved')",
                (datetime.now(UTC).isoformat(), body["model"], output_limit, reservation),
            )
            return row.lastrowid

    def settle(self, request_id: int, response: httpx.Response) -> None:
        if response.is_error:
            return
        try:
            body = response.json()
            usage = body["usage"]
            prompt, completion = usage["prompt_tokens"], usage["completion_tokens"]
        except ValueError, KeyError, TypeError:
            return
        if any(type(n) is not int or n < 0 for n in (prompt, completion)):
            return
        with closing(sqlite3.connect(self.path)) as db, db:
            output_limit = db.execute(
                "SELECT output_limit FROM requests WHERE id = ?", (request_id,)
            ).fetchone()[0]
            if prompt > CONTEXT_LIMIT or completion > output_limit:
                raise BudgetExceeded(
                    "Provider usage exceeded the reserved token bounds; stop runs."
                )
            cached = usage.get("prompt_cache_hit_tokens")
            if type(cached) is not int or not 0 <= cached <= prompt:
                cached = None
            db.execute(
                "UPDATE requests SET charge_micro=?, prompt_tokens=?, completion_tokens=?, "
                "cache_hit_tokens=?, reported_model=?, outcome='measured' WHERE id=?",
                (
                    self.cost_upper_bound(prompt, completion),
                    prompt,
                    completion,
                    cached,
                    str(body.get("model", "unknown")),
                    request_id,
                ),
            )

    def report(self) -> dict:
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            rows = [dict(row) for row in db.execute("SELECT * FROM requests ORDER BY id")]
        return {
            "limit_usd": self.limit / 1_000_000,
            "charged_or_reserved_upper_bound_usd": sum(r["charge_micro"] for r in rows) / 1_000_000,
            "pricing_source": PRICING,
            "rate_version": RATE_VERSION,
            "unresolved_reservations": sum(r["outcome"] != "measured" for r in rows),
            "requests": rows,
        }


@contextmanager
def budgeted_requests(path: Path, limit_usd: Decimal = Decimal("2")):
    ledger = BudgetLedger(path, limit_usd)
    async_send, sync_send = httpx.AsyncClient.send, httpx.Client.send

    def reserve(request):
        if request.url.host == "testserver":
            return None
        if request.url.host != "api.deepseek.com":
            if request.method in {"GET", "HEAD"}:
                return None
            raise BudgetExceeded("Unexpected outbound write request; provider was not contacted.")
        if request.method != "POST" or request.url.path not in {
            "/chat/completions",
            "/v1/chat/completions",
        }:
            raise BudgetExceeded("Unbudgeted provider endpoint; request was not sent.")
        return ledger.reserve(json.loads(request.content))

    async def guarded_async(client, request, **kwargs):
        await request.aread()
        request_id = reserve(request)
        if request_id is not None:
            kwargs["follow_redirects"] = False
        response = await async_send(client, request, **kwargs)
        if request_id is not None:
            await response.aread()
            ledger.settle(request_id, response)
        return response

    def guarded_sync(client, request, **kwargs):
        request.read()
        request_id = reserve(request)
        if request_id is not None:
            kwargs["follow_redirects"] = False
        response = sync_send(client, request, **kwargs)
        if request_id is not None:
            response.read()
            ledger.settle(request_id, response)
        return response

    with (
        patch.object(httpx.AsyncClient, "send", guarded_async),
        patch.object(httpx.Client, "send", guarded_sync),
    ):
        yield ledger


def preflight(*, storage_only: bool = False) -> dict:
    from dotenv import load_dotenv

    load_dotenv(SERVER_ROOT / ".env", override=False)
    errors = []
    for name, expected in {
        "DB_PROVIDER": "sqlite",
        "GRAPH_DATABASE_PROVIDER": "ladybug",
        "VECTOR_DB_PROVIDER": "lancedb",
        "CACHE_BACKEND": "sqlite",
    }.items():
        if os.getenv(name, expected) != expected:
            errors.append(f"Experiments require isolated embedded storage: {name}={expected}.")
    if any(os.getenv(name) for name in ("DB_CONNECTION_STRING", "DB_PATH", "CACHE_DB_URL")):
        errors.append("Custom database paths/connections need an explicit isolation review first.")
    if storage_only:
        return {"ready": not errors, "errors": errors}
    if os.getenv("LLM_API_KEY", "").strip() in {"", "sk-..."}:
        errors.append("Configure LLM_API_KEY securely in this worktree.")
    if os.getenv("LLM_PROVIDER") != "custom":
        errors.append("The budget guard supports LLM_PROVIDER=custom only.")
    if os.getenv("LLM_MODEL") not in {f"openai/{model}" for model in MODELS}:
        errors.append(
            "Choose the verified openai/deepseek-flash or openai/deepseek-v4-flash model."
        )
    if os.getenv("LLM_ENDPOINT", "").rstrip("/") not in {
        "https://api.deepseek.com",
        "https://api.deepseek.com/v1",
    }:
        errors.append("The budget guard supports the official DeepSeek endpoint only.")
    if os.getenv("EMBEDDING_PROVIDER") != "fastembed":
        errors.append("Use local fastembed embeddings for these experiments.")
    if os.getenv("ENABLE_BACKEND_ACCESS_CONTROL", "true").lower() != "true":
        errors.append("Backend access control must remain enabled.")
    if os.getenv("STRUCTURED_OUTPUT_FRAMEWORK", "litellm_native") != "litellm_native":
        errors.append("The experiment transport is verified for litellm_native only.")
    for prefix in ("LLM_EXTRACTION_", "LLM_SUMMARIZATION_", "LLM_QUERY_", "FALLBACK_"):
        if any(value for key, value in os.environ.items() if key.startswith(prefix)):
            errors.append("Remove stage-specific/fallback routing overrides for the experiment.")
            break
    return {"ready": not errors, "errors": errors, "pricing_source": PRICING}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run canaries within the shared experiment budget."
    )
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--limit-usd", type=Decimal, default=Decimal("2"))
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args()
    if args.report:
        print(json.dumps(BudgetLedger(args.ledger, args.limit_usd).report(), indent=2))
        return 0
    check = preflight()
    print(json.dumps(check, indent=2))
    if not args.run:
        return 0 if check["ready"] else 2
    if not check["ready"]:
        return 2
    os.environ["COGNEE_LOG_FILE"] = "false"
    os.environ["TELEMETRY_DISABLED"] = "1"
    os.environ["AUTO_FEEDBACK"] = "false"
    os.environ.setdefault("LLM_MAX_COMPLETION_TOKENS", "16384")
    import pytest

    with budgeted_requests(args.ledger, args.limit_usd) as ledger:
        try:
            return int(pytest.main(["tests/test_canary.py", "-m", "canary", "-v", "--tb=short"]))
        finally:
            print(json.dumps(ledger.report(), indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
