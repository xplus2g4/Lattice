# BENCH-0001: one Cognify call for ten files versus one call per file

- **Date:** 2026-09-24
- **Status:** Final
- **Claim under test:** handing Cognee ten files in one `add` plus one `cognify` call finishes in less than half the wall-clock of ten serial `Engine.replace` calls, with the same files ready and within 10% of the tokens.
- **Decision it feeds:** ADR 0007, adopt batched ingest per Dataset with a hard cap of 10 files per call; to be recorded with the implementation.

## The claim

"Batching is faster" restated so it can fail. For the same ten cs4234 lecture PDFs on this machine, one `cognee.add([...])` followed by one `cognee.cognify(data_per_batch=10, raise_on_error=False)`:

1. completes in at most 50% of the median wall-clock of ten sequential `Engine.replace` calls;
2. ends with 10 of 10 files carrying Cognee's `cognify_pipeline` completed marker, the same as serial;
3. draws no HTTP 429 from the provider and no RPM-limiter warning from Cognee;
4. uses output tokens within ±10% of the serial arm's median.

All four must hold for the claim to be confirmed. Any one failing refutes it as stated.

## Isolated variable

One Cognify call for all files (batched, width 10) against one call per file (serial: the production path, `Engine.replace` under `Engine.turn`, as `Ingest.material` runs it). Held constant: the files and their order, model, chunk size, `LLM_ARGS`, a fresh temporary Cognee root and a fresh subprocess per run, the machine, no other load, the laptop awake.

**Null arm.** Both arms rerun with the LLM's answers replayed at zero latency from a store recorded during the serial warm-up (`server/scripts/llm_replay.py`). Same outputs, no provider time, so the floor of PDF loading, chunking, CPU embeddings, graph and vector writes and Cognee bookkeeping is measured on its own. A replayed prompt the store has never seen is counted as a miss and fails the run, so the floor also checks that both arms send identical prompts.

## Environment

| | |
|---|---|
| Machine | Intel i7-10875H, 16 threads, 7.7 GB RAM inside WSL2 (Linux 6.18.33) on a Windows laptop |
| Runtime | Python 3.14.7 in the uv venv; Cognee 1.5.4; fastembed `BAAI/bge-small-en-v1.5` on CPU; embedded SQLite, LanceDB and Kuzu per run |
| Build | commit `9429d94` on `feat/multifile` ("Recover Materials on restart, isolate failed files, bound LLM retries"): `Engine.turn`, failed-file cleanup, Material recovery; `LLM_ARGS={"timeout": 300, "max_retries": 0}`. The first five live runs ran in the working tree at that content; the redone sixth ran from a detached worktree at that commit via `--code`, because the working tree had moved to another branch in between |
| LLM | DeepSeek V4 Flash through LiteLLM's `openai/` route; live arms pass through the stand-in in record mode, which forwards and counts spend |
| Conditions | docker compose API idle; each run records its clock time, and wall-clock minus monotonic time (positive means the host slept); WSL journal checked for sleep gaps afterwards |

## Method

From `server/`, in this order, with `PDFS` holding the ten files and `OUT` the results directory:

```
uv run --locked python scripts/bench_cognify.py --phase check  --pdfs PDFS --out OUT
uv run --locked python scripts/bench_cognify.py --phase record --pdfs PDFS --out OUT
uv run --locked python scripts/bench_cognify.py --phase replay --pdfs PDFS --out OUT
uv run --locked python scripts/bench_cognify.py --phase live   --pdfs PDFS --out OUT
uv run --locked python scripts/bench_cognify.py --phase summary --out OUT
```

Inputs: the first ten cs4234 Materials by sha256, copied out of the uploads volume (not committed).

| sha256 | bytes | Material |
|---|---|---|
| 14ecd092… | 766,483 | L3-MAX-SAT1.pdf |
| 26d7f505… | 416,545 | L4-MAX-SAT2-updated.pdf |
| 2827add0… | 2,989,947 | L9-LP3.pdf |
| 2b37ceab… | 172,667 | A2-sol.pdf |
| 466ce4ba… | 2,307,924 | L7-LP1.pdf |
| 57f8fd3a… | 1,318,011 | L2-VC-TSP.pdf |
| 6d3b2af6… | 556,900 | L5-NetworkFlow2.pdf |
| 7188b9f6… | 577,579 | L6-NetworkFlow3.pdf |
| 72161b97… | 1,521,760 | L8-LP2.pdf |
| 8a9d5adf… | 391,813 | L1-overview.pdf |

Iterations: `check` proves one plain call reaches the stand-in before anything is spent (the harness aborts any phase in which a run makes no request through it). `record` is one serial live run, discarded as warm-up, kept as the response store. `replay` runs one discarded warm-up then serial, batched, serial, batched, serial, batched. `live` runs the same interleaving, three per arm, no warm-up since every run is a fresh process and the embedding model is already on disk. One batched run was redone with `--phase live --arms batched --runs 1 --start 3 --code <worktree>/server`; see Results.

Timing: `time.monotonic()` in the child around the whole arm, millisecond resolution; per-file for serial. Per-request latency and peak concurrency at the stand-in. Tokens from Cognee's `pipeline_runs`. Ready count from each file's `pipeline_status`. CPU as the machine-wide busy share of `/proc/stat` over the run. 429s and limiter warnings from the stand-in's status counts and the child's log. Spend by the peak-rate upper-bound formula from `probe_runtime.py`, capped at $4 by the stand-in; harness development spent about $0.60 on one-file runs that bypassed the stand-in before the routing check existed, none of which is in the results.

## Results

Ten files per run. Replay arms answer every LLM request from the recorded store at zero latency; live arms go to DeepSeek through the stand-in.

| Run | Wall-clock s | Ready | LLM req | Max in flight | Req p50 s | Req p95 s | Req max s | 429 | Limiter | Tokens out | CPU % | Drift s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| replay-serial-1 | 300.4 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.01 | 0 | 0 | 316622 | 33.8 | -1.2 |
| replay-batched-1 | 289.6 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | 316622 | 34.4 | -1.1 |
| replay-serial-2 | 300.1 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | 316622 | 32.5 | -1.4 |
| replay-batched-2 | 286.5 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | 316622 | 31.7 | -1.2 |
| replay-serial-3 | 289.9 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | 316622 | 31.1 | -1.2 |
| replay-batched-3 | 281.1 | 10/10 | 30 | 1 | 0.0 | 0.0 | 0.0 | 0 | 0 | 316622 | 31.6 | -1.5 |
| live-serial-1 | 933.8 | 10/10 | 29 | 4 | 27.96 | 82.77 | 99.92 | 0 | 0 | 294203 | 18.6 | -21.5 |
| live-batched-1 | 356.7 | 10/10 | 29 | 28 | 19.77 | 86.0 | 100.25 | 0 | 0 | 313439 | 30.6 | -8.7 |
| live-serial-2 | 945.2 | 10/10 | 29 | 4 | 26.34 | 76.86 | 82.03 | 0 | 0 | 287093 | 19.4 | -23.9 |
| live-batched-2 | 398.4 | 10/10 | 29 | 28 | 26.56 | 69.49 | 91.02 | 0 | 0 | 268295 | 36.9 | -10.4 |
| live-serial-3 | 1173.1 | 10/10 | 29 | 4 | 24.58 | 74.72 | 92.37 | 0 | 0 | 300548 | 25.8 | -31.6 |
| live-batched-3 (redo) | 405.5 | 10/10 | 29 | 28 | 19.43 | 75.94 | 77.27 | 0 | 0 | 314194 | 25.3 | -9.1 |

| Arm | n | Median s | p95 s | Min s | Max s | Ready | Median tokens out |
|---|---|---|---|---|---|---|---|
| replay serial | 3 | 300.1 | 300.4 | 289.9 | 300.4 | 10/10/10 | 316622 |
| replay batched | 3 | 286.5 | 289.6 | 281.1 | 289.6 | 10/10/10 | 316622 |
| live serial | 3 | 945.2 | 1173.1 | 933.8 | 1173.1 | 10/10/10 | 294203 |
| live batched | 3 | 398.4 | 405.5 | 356.7 | 405.5 | 10/10/10 | 313439 |

At n=3 the p95 is the maximum and is shown only because the template asks for it.

| Criterion | Serial | Batched | Verdict |
|---|---|---|---|
| 1. Batched median at most 50% of serial median | 945.2 s | 398.4 s, 42.1% | pass |
| 2. Same files ready | 10/10 in all three | 10/10 in all three | pass |
| 3. No 429, no RPM-limiter warning | 0 and 0 at 4 in flight | 0 and 0 at 28 in flight | pass |
| 4. Output tokens within ±10% of serial median | 294,203 | 313,439, +6.5% | pass |

The floor: with the LLM's time removed, ten files take 300.1 s serial and 286.5 s batched, so batching on its own saves 4.5% of the LLM-free work. Live serial adds 645 s of LLM waiting to that floor; live batched adds 112 s, about one file's worth (the per-file serial median across all runs is 100 s), because the batch's 28 requests overlap and the batch ends when its slowest file does. Per-request latency did not rise under that concurrency: p50 19 to 27 s batched against 25 to 28 s serial, maxima 77 to 100 s in both arms.

The original third batched run (08:56 UTC) failed before its first request: the working tree had been switched to another branch whose models import `pgvector`, not yet installed in the venv, so the child could not import the engine. The harness aborted the phase as designed. It was redone at 09:01 from a worktree pinned to `9429d94`.

Spend, peak-rate upper bounds: record $0.450; six live runs $2.339 ($0.36 to $0.41 each); total for the measured phases $2.79, under the $4 cap. Harness development spent a further $0.66 on one-file runs, excluded.

## Interpretation

**Confirmed** on all four criteria. One Cognify call for ten files cut the median wall-clock from 945 s to 398 s, 2.37×, with every file ready, no provider pushback at 28 concurrent requests, and token usage inside the run-to-run noise.

The replay arms say where the gain comes from: not from batching itself, which is worth 4.5% of the CPU-bound floor, but from overlapping the LLM waiting that serial ingest pays once per file. The batched arm is bounded below by that floor of about 290 s; going wider than ten files cannot beat it on this machine, and shortening it is an embedding question, not a batching one.

Decision: adopt batched ingest per Dataset with a hard cap of 10 files per call. ADR 0007 records it with the implementation.

## Threats to validity

- One machine, under WSL2, with 16 threads shared by the embeddings and everything else.
- Ten specific decks from one course; other Materials chunk differently.
- Provider variance: the same single file produced 28.5k to 45k output tokens and took 62 s to 116 s across seven one-file runs during harness development, so run-to-run noise is around 30% before any arm difference. Three runs per arm is thin against that; all raw values are reported and the interleaving spreads time-of-day drift across both arms.
- The batched arm puts roughly six requests per file in flight at once; DeepSeek's concurrency limits are undocumented, so a 429 here says something about today's provider, not only about the design.
- The replay floor keeps the recorded outputs but removes latency entirely; a real provider is never that fast, so the floor is a lower bound, not an achievable target.
- The harness runs on the host, not in the compose container; the container adds no LLM or CPU work of its own, but its Python and filesystem differ.
- Costs are upper bounds at peak rate, not invoices.
- Wall-clock minus monotonic time was −21 to −32 s on serial runs and −9 to −10 s on batched, about −2.5% of run length in both arms: the two clocks disagree at a constant rate under WSL2, so absolute seconds may be up to 2.5% high. The ratio is unaffected. These are not sleep gaps, which would be positive; the journal shows none during the runs.
- The redone batched run came 25 minutes after its slot, so the interleaving is not a perfect alternation.
- Output tokens vary by about ±8% between runs of the same arm (batched 268k to 314k), so the +6.5% cannot be separated from noise.
- The batched arm used `raise_on_error=False` on a fresh Dataset. Mapping per-item outcomes back to Materials is production work the benchmark did not exercise.
