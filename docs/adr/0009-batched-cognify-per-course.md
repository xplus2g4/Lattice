# Cognify queued Materials in batches of up to ten per course

Ingest hands Cognee the queued Materials of one course as a single `add` plus a single `cognify` call, at most ten files at a time, instead of one call per file. Decided on 2026-09-24 on [BENCH-0001](../benchmarks/0001-batched-cognify.md): ten decks took 398 s in one call against 945 s one at a time, every file ready and no rate limiting at 28 requests in flight. The gain is LLM waiting that overlaps instead of summing; the LLM-free floor was about 290 s either way. A batch that fails is retried one file at a time, because Cognee rolls back the whole run when any item fails and reports the cause rather than the item, so only the bad file ends failed and the others pay one extra Cognify.

## Considered options

- **Parse Cognee's per-item run results to mark only the failed file.** Rejected: it needs `RAISE_INCREMENTAL_LOADING_ERRORS=false`, and the rollback still discards the other files' work, so the retry is needed anyway. The fallback reaches the same outcome without depending on that report's shape.
- **Batches wider than ten.** Rejected: on the measured machine a batch cannot finish below the CPU floor of about 290 s, and each extra file adds roughly three in-flight requests against undocumented provider limits. Ten also matches the selection cap in the web app.
- **Concurrent Cognify calls across courses.** Not taken: Cognee runs separate pipelines one at a time to avoid write conflicts in its embedded stores, so courses still take turns. Open in the [backlog](../wiki/backlog.md).

Notes are still cognified one per call; batching them is a follow-up.
