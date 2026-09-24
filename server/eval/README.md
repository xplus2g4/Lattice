# Course evaluation

Measures `/ask` on a course's seed decks: whether retrieval cites the right Material and page, and whether the answer is correct, judged by a second model family. Design, question types, metric definitions and the first trial are in [`docs/research/2026-09-23-cs4223-evaluation-design.md`](../../docs/research/2026-09-23-cs4223-evaluation-design.md) and [`docs/research/2026-09-24-cs4223-trial-findings.md`](../../docs/research/2026-09-24-cs4223-trial-findings.md).

Only `eval_course.py`, `author-questions/` and this file are committed. `eval/<COURSE>/` (the question set and run records) is ignored because it quotes the seed decks; copy anything worth keeping into `docs/research/`.

## Layout

```
eval/
  eval_course.py           the harness
  author-questions/        skill and scripts that write questions.json
  <COURSE>/
    questions.json         curated questions (local, ignored)
    runs/                  one JSON record per (chunk size, label) (local, ignored)
```

`questions.json` is `{"course": "CS4223", "questions": [...]}`; each question:

| Field | Meaning |
|---|---|
| `id`, `deck`, `type` | `L03-Q05`; the deck it belongs to (`CROSS` for cross-lecture and unanswerable); `factual`, `definition`, `formula`, `comparison`, `procedural`, `cross_lecture`, `unanswerable` |
| `question` | what is asked, verbatim |
| `reference` | the correct answer in the deck's wording |
| `key_facts` | what the answer must state; list only what the question asks for, not its premise |
| `gold_pages` | `[{"deck": "L03", "page": 74, "required": true}]`, PDF page numbers, 1-based; empty for unanswerable questions |
| `reviewed` | `ask` runs only `true` items |

Decks are read from `data/seed/<COURSE>` (or `--source <dir>`): the same PDFs the product ingests. Only decks named in some `gold_pages` are used, so a course-admin deck stays out by having no questions.

## Prerequisites

- `.env`: `LLM_*` and `EMBEDDING_*` as for the API, plus `EVAL_JUDGE_MODEL` and `EVAL_JUDGE_API_KEY` for a judge from a different model family than `LLM_MODEL`.
- Postgres at `DATABASE_URL`.
- **The API stopped.** The harness runs in-process (chunk size is a `cognify` argument the API does not expose) and takes the API's `note-ingest.lock` on the Cognee root; it refuses to start while the API holds it.
- If the Cognee root was wiped or the embedding model changed, nothing to do: `ask` re-cognifies any deck Cognee no longer holds, regardless of what Postgres says.

## Steps

All commands from `server/`.

1. **Author, then review the questions.** The `author-questions` skill ([`author-questions/SKILL.md`](author-questions/SKILL.md)) extracts deck pages, dispatches one author per deck, and merges their drafts with checks into `<COURSE>/questions.json`. Then read it against the seed decks and set `reviewed: true` per item. A wrong gold page silently poisons the retrieval metrics. Never delete an item; unreviewed items are simply not run.

2. **Quote.**
   ```sh
   uv run python eval/eval_course.py estimate
   ```
   Per chunk size: cognify cost, ask count and cost, then the judge call count. Order of magnitude only; the estimate undercounts Chunks on slide text by about 2× (trial findings). `ask` refuses when its estimate exceeds `--ceiling` (US$10).

3. **Trial.** One reviewed question per deck, one query type:
   ```sh
   uv run python eval/eval_course.py ask --chunk-size 8191 --limit 7 --label trial --query-types RAG_COMPLETION
   uv run python eval/eval_course.py judge --run eval/CS4223/runs/<stamp>-cs4223c8191-trial.json
   ```
   This pays the cognify for `cs4223c8191` once; later runs on the same course reuse it. Delete the trial record afterwards or `report` will include it.

4. **Ask.** Once per chunk size (`8191` is Cognee's default, the as-shipped row; `2048` tests whether smaller Chunks buy citation precision):
   ```sh
   uv run python eval/eval_course.py ask --chunk-size 8191
   uv run python eval/eval_course.py ask --chunk-size 2048
   uv run python eval/eval_course.py ask --chunk-size 8191 --label r2    # repeat, for variance
   ```
   Each run creates course `<course>c<chunk>`, ingests the decks if needed, asks every reviewed question in a fresh session per (question, query type) for GRAPH, RAG and HYBRID completion, and writes the record after every answer, so an interrupted run keeps what it got. Retrieval metrics are computed as it goes; no judge needed.

5. **Judge.**
   ```sh
   uv run python eval/eval_course.py judge --run eval/CS4223/runs/<file>.json
   ```
   Grades every unjudged answer (`--force` regrades all) against the reference, key facts and the text of every cited page, then writes `metrics` into the record and prints the table. Re-running skips answers already graded.

6. **Calibrate the judge.**
   ```sh
   uv run python eval/eval_course.py sample --run <file> --n 30 --out sheet.json
   # fill human_correctness / human_completeness / human_acceptable in sheet.json
   uv run python eval/eval_course.py kappa --sheet sheet.json
   ```
   Cohen's κ per dimension. Without it the judge score is unqualified.

7. **Report.**
   ```sh
   uv run python eval/eval_course.py report
   ```
   One table across every judged run under `<COURSE>/runs/`, sliced by chunk size × query type, with mean ± sd where a config has repeats.

## Reading the table

| Column | Meaning |
|---|---|
| Mat-hit | a cited Evidence maps to a gold deck |
| Page-cont | a gold page lies inside some cited `[page_start, page_end]` |
| Page-prec | cited pages ∩ gold / cited pages |
| Full-rec | every `required` gold page contained (multi-page questions) |
| MRR | 1 / rank of the first Evidence containing a gold page |
| Span | mean cited span width in pages |
| Accept | correctness 2 ∧ completeness ≥ 1 ∧ faithfulness ∈ {2, unscored} |
| Corr / Compl / Faith | judge, 0–2; faithfulness only against cited page text |
| Abstain | abstention rate on unanswerable questions |
| p50ms, $/ask | `Turn.latency_ms`; measured Cognee token usage × DeepSeek rates |

Known shape of the numbers: GRAPH_COMPLETION segment Evidence carries no page span (its context is triplets, not chunk text), so Page-cont, Page-prec, MRR and Faith are 0 or unscored for GRAPH even when the gold Chunk was cited; read those columns on RAG and HYBRID, and GRAPH on Mat-hit and answer quality. At 8,191 each deck is one or two Chunks, so spans are deck-wide by construction.
