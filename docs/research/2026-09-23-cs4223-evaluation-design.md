# CS4223 evaluation: retrieval hit rate with page numbers, and judged answer quality

23 Sep 2026, revised 24 Sep 2026. Design and dataset for evaluating `/ask` on the CS4223 seed decks (L01–L06; L00 is course admin and out of scope). Nothing here has been run against real LLM calls except a one-deck smoke of the harness; results land in `server/eval/CS4223/runs/` (ignored, as is the whole of `server/eval/`; copy what matters here) and a later dated file supersedes this one. First trial: [trial findings](./2026-09-24-cs4223-trial-findings.md).

Artifacts: `server/eval/CS4223/questions.json` (100 questions; not committed, like the seed decks it quotes, so the whole of `server/eval/` is ignored), [`eval/eval_course.py`](../../server/eval/eval_course.py) (ingests, asks, judges, reports).

Revision, 24 Sep: the first cut ran every question on two courses, the real decks and a *perturbed* copy with renamed protocols, altered formulas and inverted claims, to separate retrieval from memorised textbook knowledge. After trial runs that idea was dropped: the edited decks were no longer the product's input, and a memorisation-leak number on invented vocabulary said little about the real course. The evaluation now runs on the seed PDFs as shipped; the judge's key-facts checklist and the retrieval metrics (which do not depend on the answer at all) carry the signal. The embedding model also changed from local `fastembed` `bge-small-en-v1.5` to `openai/text-embedding-3-small`.

## Facts that shaped the design

- Cognee chunks at 8,191 tokens by default (`min(embedding_max_completion_tokens=8191, llm_max//2)`), so each deck is one or two Chunks and a citation's `page_start`–`page_end` is a regex over the loader's `Page N:` labels ([provenance findings](./2026-09-20-cognee-material-provenance-cost.md)). "Page correct" can only mean *containment* in a span at that size. The sweep is 2,048 and the shipped 8,191: the default gives the as-shipped baseline row, and 2,048 tests whether smaller Chunks buy citation precision. 512 was in an earlier cut and dropped as too far from the product.
- Embeddings are `openai/text-embedding-3-small` (1,536 dims, 8,191-token window; `server/.env`). Embedding cost is negligible next to cognify (about 26k text tokens per course at $0.02/M) and is not in the estimate.
- Cognee's `EvidenceReference` carries `rank` and `score`; Lattice's `Evidence` dropped them. They are now surfaced (`retrieval.py`) so MRR is computable and the `Turn` record shows why a citation was chosen.
- `/ask` with `CHUNKS` returns no Evidence, so only the three completion types are evaluated.
- The API's course-code pattern is `^[a-z][a-z0-9]{1,15}$`, so evaluation courses are `cs4223c2048` and `cs4223c8191` (`c` then chunk size). The seeded `cs4223` is untouched.
- Cognee records `tokens_in/tokens_out` per search under `pipeline_runs.session_id`, so cost per question is measured, not estimated.
- Gold pages were authored against `pypdf.extract_text()` of the seed PDFs, page by page, which is exactly the loader's view: page numbers are the PDF's, 1-based. Text inside figures is invisible to ingest, so no question targets it.

Observed in the one-deck harness smoke (L05, `chunk_size=512`, GRAPH_COMPLETION, 23 Sep 2026, on the earlier perturbed text-only deck and `bge-small`; the Cognee root and Postgres were wiped afterwards, so the matrix starts from nothing):

- Ingest at 512 tokens split the 23-page deck into five Chunks and cost 16,000 in / 88,767 out tokens (about US$0.11 at peak rates), versus the 40-page deck at the default size measured earlier at 17,444 / 43,600. Cognify cost is per Chunk, not per token; the matrix estimate uses that two-point fit (`eval/eval_course.py`, `COGNIFY_USD_PER_CHUNK`).
- Search usage was 2,723 in / 32 out tokens, 857 ms.
- **GRAPH_COMPLETION cites segments with no page span.** Its `objects_result` holds triplets, not chunk text, so `_page_span` has nothing to read and every segment Evidence arrives with `page_start = page_end = None` (rank 30–32 of 33, after the graph nodes and edges). This is the shipped behaviour (`test_prompt_boundary.py` only expects pages for RAG and HYBRID). Page metrics for GRAPH are therefore structurally zero; Material-hit still works through `document_name`. Compare GRAPH on Material-hit and answer quality, and read the page columns for RAG and HYBRID.
- Cognee's graph completion returns its completion wrapped in a one-element list; `_answer_text` only stripped the trailing `Evidence:` block from bare strings, so every stored GRAPH answer carried chunk ids in its text. Fixed in `engine.py` with a regression test; the smoke's own stored Turn predates the fix.

## Dataset: what is asked

100 questions, 12 per deck plus 6 cross-lecture and 10 unanswerable. Each carries `question`, `reference`, `key_facts`, `gold_pages` (1–3 pages, `required` flag), `deck`, and `reviewed`. The harness runs only reviewed questions. Eight questions (`L01-Q07`, `L02a-Q07`, `L02a-Q09`, `L02a-Q11`, `L02b-Q03`, `L04-Q04`, `L05-Q12`, `L06-Q04`) ask for an attribution or detail the deck does not give alongside facts it does; their reference says so, and they reward an answer that states what the material covers without inventing the rest.

### Table: question types

| Type | Count | Tests | Example |
|---|---|---|---|
| factual | 32 | single-page retrieval of a specific claim | "Which co-founder predicted in 1965 that transistor density keeps doubling, and what is the prediction called?" |
| definition | 14 | terminology slides | "Which write-miss policy loads the block before writing, and which writes to memory only?" |
| formula | 10 | retrieval of a relation and applying it | "What is the ideal speedup of an N-stage pipeline, and why is it not reached?" |
| comparison | 14 | two facts, often two pages | "Compare write-invalidate and write-update on bandwidth and on write propagation" |
| procedural | 14 | ordered steps across slides | "Step by step, what happens in the three-state invalidation protocol when a processor writes to a Shared line?" |
| cross_lecture | 6 | two decks required (`gold_pages` span decks) | "How does the memory wall motivate the cache hierarchy and its locality assumptions?" |
| unanswerable | 10 | abstention; topic absent from all six decks (verified by term search) | TAGE predictors, transactional memory, RISC-V vector, SC vs TSO, Spectre |

Because the decks are textbook material, a strong model can answer many factual questions from memory. Retrieval metrics are unaffected (they read Evidence, not the answer); for answer quality the key-facts checklist ties the grade to the deck's wording and figures, and faithfulness is judged only against cited page text, so an answer that is right from memory but cites the wrong page still loses.

## Procedure

1. **Review.** Read `questions.json` against the seed decks (`data/seed/CS4223`); set `reviewed: true` per item, fix or leave false. A wrong gold page silently poisons the retrieval metric, so every item gets reviewed once. Never delete an item; unreviewed items are simply not run.
2. **Estimate.** `uv run python eval/eval_course.py estimate` (from `server/`) prints per-config cognify and ask cost and the judge call count. `ask` refuses above `--ceiling` (default USD 10 per run).
3. **Stop the API.** The harness runs in-process (chunk size is a `cognify` argument the API does not expose; a second process on the Cognee root is unsafe) and takes the API's `note-ingest.lock`.
4. **Trial.** `eval_course.py ask --chunk-size 8191 --limit 7 --label trial` runs one reviewed question per deck; this pays the cognify for `cs4223c8191` once and a few cents of asks. Judge it, read the table, then delete or keep the `trial` run record.
5. **Ask.** For each of `{2048, 8191}`: `eval_course.py ask --chunk-size C`. Creates course `cs4223cC`, ingests the seven seed decks at that chunk size unless Cognee already holds them (Postgres `ready` alone is not trusted: a wiped root or a changed embedding model means a fresh cognify), asks every reviewed question in a fresh session per (question, query type) for GRAPH, RAG and HYBRID completion, and writes `runs/<stamp>-<code>-r1.json` with the raw `AskResponse`, Evidence, measured tokens and latency. Retrieval metrics are computed immediately, no LLM needed. One repeat: `ask --chunk-size 2048 --label r2` gives the run-to-run variance quoted next to every delta.
6. **Judge.** `eval_course.py judge --run <file>`. `EVAL_JUDGE_MODEL` (currently `gpt-6-sol`) with `EVAL_JUDGE_API_KEY`, JSON-schema output, default sampling (the model rejects a pinned temperature; the repeat run therefore also bounds judge noise). The judge receives the question, the reference and key facts, the text of every cited page (extracted locally from the same seed PDF; `Evidence` carries no text), and the answer. Grades are stored per answer; `metrics` per query type are written into the run file.
7. **Calibrate.** `eval_course.py sample --run <file> --n 30 --out sheet.json` draws a stratified sample (question type × query type). Hand-fill `human_*`, then `eval_course.py kappa --sheet sheet.json` reports Cohen's κ per dimension. Without this the judge score is unqualified.
8. **Report.** `eval_course.py report` prints one table across every judged run, sliced by chunk size × query type, plus mean/sd where a config has repeats.

Scoring definitions: correctness, completeness and faithfulness are 0–2; faithfulness is judged only against cited page text and is `null` when nothing with a page was cited (rate reported). **Acceptable** = correctness 2 ∧ completeness ≥ 1 ∧ faithfulness ∈ {2, null}. For unanswerable questions, abstaining is the correct answer.

### Table: result metrics

| Metric | Unit | Computed from | Reads as |
|---|---|---|---|
| Material-hit | % answerable questions | any course-tier Evidence whose `document_name` maps to a gold deck (matched by filename or content sha) | right deck retrieved at all |
| Page-containment | % | a gold page lies inside some cited `[page_start, page_end]` of the same deck | "page correct" in the containment sense |
| Page-precision | mean ratio | \|cited pages ∩ gold\| / \|cited pages\| over the union of cited spans | how much of what was cited is the answer; separates "right deck" from "right slide" |
| Full-recall | % multi-page questions | every `required` gold page contained | comparison/procedural completeness of retrieval |
| MRR | mean | 1 / rank of the first Evidence containing a gold page (Cognee `rank`; unranked graph evidence last) | whether the gold chunk is found because it is ranked or because k = 15 |
| Span width | mean pages | cited span length | how vague the citation is |
| Acceptable-answer rate | % judged answerable | threshold above | the headline |
| Correctness / Completeness / Faithfulness | mean 0–2 | judge | where answers fail |
| Faithfulness-unscored | % | answers with no page-bearing citation | how often the judge could not check grounding |
| Abstention rate | % unanswerable | judge `abstained` | correct refusals |
| False-abstention rate | % answerable | judge `abstained` | over-refusal |
| Latency p50 / p95 | ms | `Turn.latency_ms` | |
| Cost per ask | USD | `pipeline_runs` tokens × DeepSeek rates | |
| Judge–human κ | Cohen's κ | 30-item sheet | whether any of the above is trustworthy |

All metrics are per query type; `by_question_type` gives Acceptable and Page-containment per question type inside each run.

## What this does not settle

- Chunk size is passed only by the harness (`Engine.replace(chunk_size=)`); the product ingests at Cognee's default of 8,191, the `cs4223c8191` row. Backlog #6 (page attribution) decides whether to change the default; this harness is the measurement it was missing.
- Answer quality cannot distinguish an answer retrieved from the deck from one recalled from the textbook; only the retrieval and faithfulness columns can. A perturbed-corpus control was tried and dropped (revision note above).
- Cost estimates for `ask` scale a single measured deck and assume `top_k=15` full-size chunks for RAG; the run record's measured tokens replace them after the first run.
