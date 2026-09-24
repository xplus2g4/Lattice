"""BENCH-0001 harness (docs/benchmarks/0001-batched-cognify.md).

Serial ingest, one `Engine.replace` per file exactly as `Ingest.material` does it, against one
batched `cognee.add` plus one `cognee.cognify` over the same files. Every run gets a fresh
temporary Cognee root and its own subprocess, so nothing Cognee memoises leaks between runs.
The LLM is reached through `llm_replay.py`, which either forwards to the provider and records
(`record`, `live`) or replays the recorded answers at zero latency (`replay`, the floor).

Phases, run in this order from `server/`:

    uv run --locked python scripts/bench_cognify.py --phase record  --pdfs DIR --out DIR
    uv run --locked python scripts/bench_cognify.py --phase replay  --pdfs DIR --out DIR
    uv run --locked python scripts/bench_cognify.py --phase live    --pdfs DIR --out DIR
    uv run --locked python scripts/bench_cognify.py --phase summary --out DIR

`record` is one serial live run, discarded as warm-up but kept as the response store. `replay`
and `live` interleave the arms serial, batched, serial, batched... `--runs` times each, replay
after one discarded warm-up. One JSON line per run lands in `<out>/runs.jsonl`.
"""

import argparse
import asyncio
import json
import os
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import httpx

SERVER_ROOT = Path(__file__).resolve().parents[1]
SCRATCH_PREFIX = "lat"  # short on purpose; see tests/conftest.py::workspace


# --- one run, in its own process -------------------------------------------------------------


def read_cpu() -> tuple[int, int]:
    """(busy, total) jiffies for the whole machine, from the first line of /proc/stat."""
    fields = [int(x) for x in Path("/proc/stat").read_text().split("\n")[0].split()[1:]]
    idle = fields[3] + fields[4]
    return sum(fields) - idle, sum(fields)


async def run_one(arm: str, root: Path, paths: list[Path], width: int) -> dict:
    # Import here: the environment (endpoint, cache paths) must be set before Cognee loads.
    import cognee
    from cognee.modules.data.methods import get_dataset_data

    from lattice.config import Settings
    from lattice.engine import Engine

    engine = Engine(
        Settings(
            _env_file=None,
            cognee_root=root / "c",
            uploads_dir=root / "u",
            dev_header_auth=True,
            mcp_enabled=False,
        )
    )
    await engine.start()
    user = await engine.instructor()
    dataset = await engine.global_dataset("bench")

    errors: list[str] = []
    per_file: list[float] = []
    wall_start, mono_start, cpu_start = time.time(), time.monotonic(), read_cpu()
    if arm == "serial":
        for path in paths:
            file_start = time.monotonic()
            try:
                async with engine.turn:
                    await engine.replace(dataset, user, path)
            except Exception as exc:  # noqa: BLE001 - recorded, as Ingest.material records it
                errors.append(f"{path.name}: {type(exc).__name__}: {exc}"[:300])
            per_file.append(time.monotonic() - file_start)
    else:
        try:
            async with engine.turn:
                await cognee.add([str(p) for p in paths], dataset_id=dataset.id, user=user)
                await cognee.cognify(
                    datasets=[dataset.id], user=user, data_per_batch=width, raise_on_error=False
                )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"batch: {type(exc).__name__}: {exc}"[:300])
    elapsed = time.monotonic() - mono_start
    wall = time.time() - wall_start
    cpu_end = read_cpu()

    marker = f'"{dataset.id}": "DATA_ITEM_PROCESSING_COMPLETED"'
    file_tokens = {}
    ready = 0
    for data in await get_dataset_data(dataset.id):
        file_tokens[data.name[:12]] = data.token_count
        if marker in json.dumps(data.pipeline_status.get("cognify_pipeline", {})):
            ready += 1
    with closing(sqlite3.connect(root / "c" / "system" / "databases" / "cognee_db")) as db:
        tokens_in, tokens_out, runs = db.execute(
            "select coalesce(sum(tokens_in),0), coalesce(sum(tokens_out),0), count(*) "
            "from pipeline_runs where pipeline_name='cognify_pipeline' "
            "and status in ('DATASET_PROCESSING_COMPLETED','DATASET_PROCESSING_ERRORED')"
        ).fetchone()
    busy = cpu_end[0] - cpu_start[0]
    total = cpu_end[1] - cpu_start[1]
    return {
        "arm": arm,
        "files": len(paths),
        "elapsed_s": round(elapsed, 1),
        # Wall-clock minus monotonic: a positive gap means the host slept during the run.
        "clock_drift_s": round(wall - elapsed, 1),
        "cpu_busy_pct": round(100 * busy / total, 1) if total else None,
        "ready": ready,
        "failed": len(paths) - ready,
        "errors": errors,
        "per_file_s": [round(x, 1) for x in per_file],
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cognify_runs": runs,
        "file_tokens": file_tokens,
    }


def child_main(args: argparse.Namespace) -> None:
    root = Path(args.root)
    os.environ["COGNEE_LOG_FILE"] = "false"
    os.environ["TELEMETRY_DISABLED"] = "1"
    os.environ["CACHE_BACKEND"] = "sqlite"
    os.environ["CACHE_DB_URL"] = f"sqlite+aiosqlite:///{root.as_posix()}/s.db"
    # Importing Cognee runs load_dotenv(override=True), which finds server/.env by walking up
    # from the package directory, and its config is cached at import: an environment override
    # is silently lost. The config setter is the supported route, and the run refuses to start
    # unless the client it would call is pointed at the stand-in.
    endpoint = os.environ["LLM_ENDPOINT"]
    import cognee
    from cognee.infrastructure.llm.structured_output_framework.litellm_native import (
        get_native_client,
    )

    cognee.config.set_llm_config({"llm_endpoint": endpoint})
    actual = get_native_client.get_native_client().endpoint
    if actual != endpoint:
        raise SystemExit(f"LLM client points at {actual}, not {endpoint}")
    if args.check:
        from cognee.infrastructure.llm.LLMGateway import LLMGateway

        answer = asyncio.run(
            LLMGateway.acreate_structured_output(
                text_input="ping", system_prompt="Reply with one word.", response_model=str
            )
        )
        Path(args.result).write_text(json.dumps({"arm": "check", "answer": str(answer)[:40]}))
        return
    paths = [Path(p) for p in args.files]
    result = asyncio.run(run_one(args.arm, root, paths, args.width))
    Path(args.result).write_text(json.dumps(result))


# --- the orchestrator ------------------------------------------------------------------------


def dotenv() -> dict[str, str]:
    """server/.env as a dict. Cognee re-reads .env over the process environment when it finds
    one in the working directory, so the child runs from its temp root with these passed
    explicitly and the endpoint overridden; nothing there can undo the override."""
    values = {}
    for line in (SERVER_ROOT / ".env").read_text().splitlines():
        key, _, value = line.partition("=")
        if key.strip() and not key.startswith("#") and _:
            values[key.strip()] = value.strip().strip("\"'")
    return values


def env_value(name: str) -> str:
    try:
        return dotenv()[name]
    except KeyError:
        raise SystemExit(f"{name} is not set in server/.env") from None


class Stub:
    def __init__(self, mode: str, store: Path, port: int, cap_usd: float, log: Path) -> None:
        command = [
            sys.executable,
            str(SERVER_ROOT / "scripts" / "llm_replay.py"),
            "--mode",
            mode,
            "--store",
            str(store),
            "--port",
            str(port),
            "--cap-usd",
            str(cap_usd),
        ]
        if mode == "record":
            command += ["--upstream", env_value("LLM_ENDPOINT")]
        self.url = f"http://127.0.0.1:{port}"
        self.log = log.open("ab")
        self.process = subprocess.Popen(command, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                httpx.get(f"{self.url}/bench/stats", timeout=1)
                return
            except httpx.HTTPError:
                time.sleep(0.2)
        raise SystemExit("the LLM stand-in did not come up")

    def begin(self, run: str) -> dict:
        return httpx.post(f"{self.url}/bench/begin", json={"run": run}, timeout=5).json()

    def stats(self) -> dict:
        return httpx.get(f"{self.url}/bench/stats", timeout=5).json()

    def stop(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=10)
        self.log.close()


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))], 2)


def run_child(
    arm: str,
    paths: list[Path],
    stub: Stub,
    width: int,
    out: Path,
    name: str,
    check: bool = False,
    code: Path | None = None,
) -> dict:
    root = Path(tempfile.mkdtemp(prefix=SCRATCH_PREFIX))
    result_path = root / "result.json"
    log_path = out / f"{name}.log"
    env = {**os.environ, **dotenv(), "LLM_ENDPOINT": f"{stub.url}/v1"}
    if code:
        # Import `lattice` from a pinned checkout rather than the live working tree, so edits
        # made while the phase runs cannot change or break a later run.
        env["PYTHONPATH"] = str(code)
    stub.begin(name)
    started = datetime.now(UTC)
    with log_path.open("wb") as log:
        completed = subprocess.run(
            [
                sys.executable,
                __file__,
                "--child",
                "--arm",
                arm,
                "--root",
                str(root),
                "--width",
                str(width),
                "--result",
                str(result_path),
                "--files",
                *[str(p) for p in paths],
                *(["--check"] if check else []),
            ],
            env=env,
            cwd=root,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    ended = datetime.now(UTC)
    log_text = log_path.read_text(errors="replace")
    result = json.loads(result_path.read_text()) if result_path.exists() else {"arm": arm}
    stats = stub.stats()
    shutil.rmtree(root, ignore_errors=True)
    return {
        "run": name,
        "started_at": started.isoformat(timespec="seconds"),
        "ended_at": ended.isoformat(timespec="seconds"),
        "exit_code": completed.returncode,
        **result,
        "llm": {
            **{k: v for k, v in stats.items() if k != "latencies_s"},
            "latency_p50_s": percentile(stats.get("latencies_s", []), 0.5),
            "latency_p95_s": percentile(stats.get("latencies_s", []), 0.95),
            "latency_max_s": percentile(stats.get("latencies_s", []), 1.0),
        },
        "log_flags": {
            "rpm_limiter_warnings": log_text.count("Potential RPM issues"),
            "timeouts": log_text.count("litellm.Timeout"),
            "tracebacks": log_text.count("Traceback (most recent call last)"),
        },
    }


def phase_runs(
    phase: str, runs: int, arms: tuple[str, ...] = ("serial", "batched"), start: int = 1
) -> list[tuple[str, str, bool]]:
    """(name, arm, counts) in execution order. `arms` and `start` let one lost run be redone."""
    if phase == "check":
        return [("check-routing", "check", False)]
    if phase == "record":
        return [("record-serial-warmup", "serial", False)]
    order = []
    if phase == "replay" and start == 1:
        order.append(("replay-serial-warmup", "serial", False))
    for i in range(start, start + runs):
        for arm in arms:
            order.append((f"{phase}-{arm}-{i}", arm, True))
    return order


def orchestrate(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    paths = sorted(Path(args.pdfs).glob("*.pdf"))[: args.files]
    if len(paths) < args.files:
        raise SystemExit(f"only {len(paths)} PDFs under {args.pdfs}")
    # `check` replays against an empty throwaway store: one plain call must arrive here.
    mode = "replay" if args.phase in ("replay", "check") else "record"
    store = out / ("check.sqlite" if args.phase == "check" else "responses.sqlite")
    stub = Stub(mode, store, args.port, args.cap_usd, out / "stub.log")
    try:
        with (out / "runs.jsonl").open("a") as sink:
            for name, arm, counts in phase_runs(
                args.phase, args.runs, tuple(args.arms.split(",")), args.start
            ):
                print(f"[{datetime.now(UTC):%H:%M:%S}] {name} ...", flush=True)
                row = run_child(
                    arm,
                    paths,
                    stub,
                    args.width,
                    out,
                    name,
                    check=arm == "check",
                    code=Path(args.code) if args.code else None,
                )
                if row["exit_code"] != 0 or not row["llm"]["requests"]:
                    # A run that never reached the stand-in went to the provider directly, or
                    # never started; either way its numbers are wrong and further runs cost.
                    raise SystemExit(
                        f"{name}: exit {row['exit_code']}, {row['llm']['requests']} LLM "
                        f"requests seen through the stand-in; see {name}.log"
                    )
                row["counts"] = counts
                row["phase"] = args.phase
                sink.write(json.dumps(row) + "\n")
                sink.flush()
                print(
                    f"  {row.get('elapsed_s')} s, ready {row.get('ready')}/{row.get('files')}, "
                    f"llm {row['llm'].get('requests')} req max {row['llm'].get('max_in_flight')} "
                    f"in flight, p50 {row['llm'].get('latency_p50_s')} s, "
                    f"${row['llm'].get('spend_usd', 0):.3f}, drift {row.get('clock_drift_s')} s",
                    flush=True,
                )
    finally:
        stub.stop()


def summary(args: argparse.Namespace) -> None:
    rows = [json.loads(line) for line in (Path(args.out) / "runs.jsonl").read_text().splitlines()]
    print(f"{'arm':22} {'n':>2} {'median s':>9} {'min':>7} {'max':>7} {'ready':>6} {'tok out':>8}")
    for phase in ("replay", "live"):
        for arm in ("serial", "batched"):
            group = [r for r in rows if r["phase"] == phase and r["arm"] == arm and r["counts"]]
            if not group:
                continue
            times = [r["elapsed_s"] for r in group]
            print(
                f"{phase + ' ' + arm:22} {len(group):>2} {statistics.median(times):>9.1f} "
                f"{min(times):>7.1f} {max(times):>7.1f} "
                f"{'/'.join(str(r['ready']) for r in group):>6} "
                f"{int(statistics.median(r['tokens_out'] for r in group)):>8}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--check", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--arm", choices=("serial", "batched", "check"), help=argparse.SUPPRESS)
    parser.add_argument("--root", help=argparse.SUPPRESS)
    parser.add_argument("--result", help=argparse.SUPPRESS)
    parser.add_argument("--files", nargs="*", default=[], help=argparse.SUPPRESS)
    parser.add_argument("--phase", choices=("check", "record", "replay", "live", "summary"))
    parser.add_argument("--pdfs", help="directory of PDFs; the first --count sorted by name")
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--out", help="where runs.jsonl, logs and the response store go")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--width", type=int, default=10, help="data_per_batch for the batched arm")
    parser.add_argument("--cap-usd", type=float, default=4.0)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--arms", default="serial,batched", help="comma-separated arms to run")
    parser.add_argument("--start", type=int, default=1, help="first run number, to redo one")
    parser.add_argument("--code", help="directory holding a pinned `lattice` package to import")
    args = parser.parse_args()
    if args.child:
        child_main(args)
        return
    if not args.out or not args.phase:
        parser.error("--phase and --out are required")
    if args.phase == "summary":
        summary(args)
    else:
        args.files = args.count
        orchestrate(args)


if __name__ == "__main__":
    main()
