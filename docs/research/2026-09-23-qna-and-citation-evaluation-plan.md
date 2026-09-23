# Evaluating Lattice: QnA precision/recall and Citation precision

Point-in-time research, 23 Sep 2026. A plan, not an implementation: it defines what to measure,
what Lattice can and cannot expose today, how to build the ground truth, and how many labelled
questions are needed before a number means anything. Nothing here is built yet.

## 1. What the question really asks

"QnA precision and recall" and "Reference precision" are two of five layers that a cited-answer
system fails at independently. Measuring them jointly hides the cause of every failure:

| Layer | Question it answers | Fails alone when |
| --- | --- | --- |
| Retrieval | Did search return the Chunks that contain the answer? | Chunking, embeddings, `top_k`, graph seeds |
| Answer | Is the answer correct and complete? | Prompt, model, context ordering |
| Citation | Do the returned Citations actually support what the answer says? | Evidence extraction, Page mapping |
| Isolation | Did anything leak across Tiers or courses? | Dataset filtering |
| Operations | How slow and how expensive was the Turn? | Retriever choice, model choice |

Two diagnostics justify the split. A correct answer over bad retrieval means the model answered
from parametric knowledge, which will not generalise to the next course; good retrieval with a bad
answer is a generation problem. RAGChecker is built on exactly this decomposition, reporting
retriever, generator and overall metrics separately from claim-level entailment
([arXiv:2408.08067](https://arxiv.org/html/2408.08067)).

For Lattice the Citation layer is not a nice-to-have: a Turn renders Page badges the student
clicks through to the Material (`app/src/lib/references.ts`, `describeCitation`). A correct answer
with a wrong Page badge is a product defect, so Citation quality gets first-class metrics rather
than being folded into answer quality.

## 2. What Lattice can be measured through today

Read from the source, not from the docs.

`server/lattice/retrieval.py` returns one `TierResult` per Tier, each carrying `answer` plus a
list of `Evidence`:

```python
class Evidence(BaseModel):
    kind: str
    dataset_id: str | None = None
    data_id: str | None = None
    chunk_id: str | None = None
    chunk_index: int | None = None
    document_name: str | None = None
    label: str | None = None
    relationship_name: str | None = None
    page_start: int | None = None
    page_end: int | None = None
```

`server/lattice/study.py` persists per assistant Turn: the full `results` JSON, `query_type`,
`cited_chunk_ids`, `used_notes` and `latency_ms`. `server/lattice/db/models/conversation.py`
confirms those are real columns, and `Feedback` already stores a per-Turn thumb rating. So an
offline harness needs no schema change to capture a run.

Four retrieval modes are in scope, from `study.py`:

```python
QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
```

Three constraints follow from the code and change the metric design:

1. **Citations are answer-level, not statement-level.** `_StructuredReferences` in
   `server/lattice/grounding.py` deliberately suppresses Cognee's inline reference block
   ("Citations travel as structured Evidence, so the answer text gets no Evidence block"), and
   `Evidence` has no field tying a Citation to a sentence or claim. Nothing in the pipeline records
   *which* claim a Citation supports.
2. **Some Citations are not text at all.** `kind` is `chunk`, `relation` or an entity label
   (`app/src/lib/api.ts`, `describeCitation`). Graph Citations have no passage to entail a claim
   against, so they cannot enter a text-entailment metric.
3. **Page spans are approximate and known-unreliable.** `Evidence.page_start/page_end` are read
   from loader page labels; backlog issue [#6](https://github.com/xplus2g4/Lattice/issues/6)
   ("Reliable page/slide attribution") is open, with the PDF and PPTX findings showing Chunk
   indices and text headers are insufficient.

### 2.1 The consequence for "Reference precision"

The standard definition of Citation precision/recall is ALCE's, and it is per-statement: citation
recall is the share of answer statements *fully supported* by their cited passages, and citation
precision is the share of citations that are relevant to the statement they are attached to and
non-redundant — a citation that could be removed without losing support is counted as imprecise
([arXiv:2305.14627](https://arxiv.org/html/2305.14627),
[ACL](https://aclanthology.org/2023.emnlp-main.398/)).

Lattice cannot produce that number today, because there is no statement→Citation attachment to
score. This is the single most important finding of this research. There are two ways forward and
the choice should be explicit:

- **Option A (no product change).** Score Citations as an unordered evidence *set* against the
  answer: for each answer claim, ask whether any returned Chunk Citation entails it (set-level
  recall), and for each Citation, whether it entails at least one claim (set-level precision).
  This is measurable now but is a weaker guarantee: it cannot catch a Citation attached to the
  wrong sentence, and it rewards dumping `top_k` Chunks into the reference list.
- **Option B (small product change, recommended before launch).** Emit per-claim or per-sentence
  Citation indices alongside the structured Evidence, then compute ALCE citation precision/recall
  directly. This is a schema and prompt change, out of scope here, but the evaluation plan should
  drive the decision rather than quietly accept Option A's ceiling.

Plan of record: build the harness for Option A, report set-level Citation metrics, and log
"claim with support in the evidence set but no way to tell which Citation" as its own error class
so the size of the gap Option B would close is quantified rather than asserted.

## 3. Evaluation unit and ground truth

One record per question. JSONL, one file per course, versioned against a frozen Material snapshot.

```json
{
  "id": "cs2100-q017",
  "course": "CS2100",
  "kind": "comparison",
  "question": "How do sign extension and zero extension differ?",
  "gold_answer": "…reference answer, 1–4 sentences…",
  "gold_claims": [
    "Sign extension repeats the most significant bit.",
    "Zero extension fills the new high bits with zeros.",
    "Only sign extension preserves the value of a negative signed integer."
  ],
  "gold_chunk_ids": ["…"],
  "gold_material": "week03-number-systems.pdf",
  "gold_pages": [[12, 13]],
  "answerable": true,
  "abstention_expected": false,
  "tier": "course",
  "snapshot": "2026-09-23-cs2100",
  "annotators": ["a1", "a2"],
  "notes": "adjudicated: a2 initially marked claim 3 optional"
}
```

`gold_claims` is the unit that makes precision and recall meaningful for long-form answers; token
F1 and exact match cannot distinguish a complete answer from a verbose one. `gold_chunk_ids` is
what makes retrieval measurable independently of the model, and it must be collected by having an
annotator read the Material, not by accepting what Lattice retrieved (that would make every
retrieval metric circular).

### 3.1 Question mix

Extend the six kinds the existing synthetic canary already uses in
`server/tests/test_study_evaluation.py` (`direct`, `paraphrase`, `comparison`, `application`,
`false_premise`, `unsupported`) with three that the canary lacks:

| Kind | Share | Why it is in the set |
| --- | --- | --- |
| `direct` | 20% | Baseline lookup; isolates chunking and embeddings |
| `paraphrase` | 15% | Vocabulary mismatch between student and Material |
| `comparison` | 15% | Needs two Chunks, often two Materials — separates GRAPH from RAG |
| `application` | 15% | Reasoning over retrieved facts, not extraction |
| `multi_part` | 10% | Exposes partial answers that claim recall catches and a thumbs-up does not |
| `ambiguous` | 5% | Should ask back or cover both readings, not guess |
| `false_premise` | 10% | Must contradict the premise, not accept it |
| `unsupported` | 10% | Must abstain with "Not covered by the supplied materials." |

The last two are a third of the set on purpose. `GROUNDING_POLICY` in
`server/lattice/grounding.py` mandates the abstention string, and NoMIRACL shows how badly this
capability is distributed: on non-relevant passages, LLAMA-2 and Orca-2 hallucinate on over 88% of
queries, while models that abstain readily reach up to a 74.9% error rate on the relevant subset —
models struggle to balance the two, so both subsets must be measured together or the metric is
gameable by always abstaining
([arXiv:2312.11361](https://arxiv.org/html/2312.11361v1),
[ACL](https://aclanthology.org/2024.findings-emnlp.730/)).

### 3.2 Annotation protocol

- Two annotators independently write `gold_claims` and `gold_chunk_ids` for every question in the
  pilot set; a third adjudicates disagreements, and the adjudicated version is the gold.
- Report inter-annotator agreement (Cohen's κ on claim-level judgements) as a metric of the *set*,
  not of the system. An evaluation whose annotators agree at κ≈0.5 cannot detect a 5-point system
  difference.
- Keep answer correctness and Citation correctness on separate judgement forms. An annotator who
  has just decided the answer is right is primed to accept its Citations.
- Annotators label against the frozen Material snapshot only. Anything true but absent from the
  snapshot is `unsupported`, however obvious.

## 4. Metrics

Notation: generated claims \(G\), gold claims \(Y\), retrieved Chunks \(R_k\), gold Chunks \(G_R\),
Chunk Citations returned with the answer \(C\).

### 4.1 Answer (the "QnA precision and recall" ask)

\[
\text{AnswerPrecision}=\frac{|\{g\in G:\ g\ \text{is supported by the snapshot and not contradicted by } Y\}|}{|G|}
\qquad
\text{AnswerRecall}=\frac{|\{y\in Y:\ y\ \text{is covered by } G\}|}{|Y|}
\]

\[
\text{AnswerF1}=\frac{2\,P\,R}{P+R}
\]

Claim extraction and entailment are judged by an LLM judge with human spot-checking; this is
RAGChecker's construction and the reason it reports claim-level rather than token-level scores
(arXiv:2408.08067). Keep token F1 and exact match as cheap secondary signals — they are what
Cognee's bundled `eval_framework` already computes by default (`evaluation_metrics = ["correctness",
"EM", "f1"]` in `cognee/eval_framework/eval_config.py`) — but do not gate on them for long-form
answers.

Also report, per question kind: **completeness** (all parts of a `multi_part` question answered),
**correct abstention rate** on the `unsupported` and `false_premise` subsets, and **hallucination
rate** on those same subsets, using NoMIRACL's two-sided framing so abstaining on everything scores
badly on the answerable subset.

### 4.2 Retrieval

\[
\text{P@k}=\frac{|R_k\cap G_R|}{|R_k|}
\qquad
\text{R@k}=\frac{|R_k\cap G_R|}{|G_R|}
\qquad
\text{MRR},\ \text{nDCG@k}
\]

Plus the two reference-free framings from Ragas, which are worth computing because they do not need
`gold_chunk_ids` and so extend to production sampling: **context precision**, whether relevant
Chunks are ranked above irrelevant ones
([docs](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)),
and **context recall**, the share of reference-answer claims attributable to the retrieved context
([docs](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/)).

`CHUNKS` mode returns retrieval with no generation, which makes it the clean upper bound for what
the other three modes could have answered from. Report every retrieval metric for all four modes;
gaps between `CHUNKS` retrieval quality and `*_COMPLETION` answer quality localise the failure to
generation.

### 4.3 Citation ("Reference precision")

Set-level, per Option A above, over Chunk Citations only:

\[
\text{CitationPrecision}=\frac{|\{c\in C:\ c\ \text{entails at least one claim in } G\}|}{|C|}
\qquad
\text{CitationRecall}=\frac{|\{g\in G_{\text{ext}}:\ \exists c\in C,\ c\models g\}|}{|G_{\text{ext}}|}
\]

where \(G_{\text{ext}}\) is the claims needing external evidence (excluding restatements of the
question and hedges). Report alongside:

- **Citation resolution rate** — share of returned `chunk_id`s that resolve to a live Chunk and a
  Material the caller can open. `references.ts` silently drops a Citation with no `filename`, so an
  unresolvable Citation is invisible in the UI and must be caught here. Target: 1.0.
- **Page attribution accuracy** — share of Chunk Citations whose `page_start`/`page_end` overlap
  the annotated `gold_pages`. Report separately and expect it to be the weakest number in the
  report while issue #6 is open; do not let it depress the Chunk-level figure.
- **Citation redundancy** — Citations removable without losing claim support, as ALCE's precision
  requires; this is the metric that punishes dumping all of `top_k` into the reference list.
- **Graph Citation usefulness** — for `relation`/entity Citations, a human 3-point rubric
  (on-topic and useful / on-topic but unhelpful / irrelevant). Not an entailment metric; reported
  as its own column, never mixed into Citation precision.
- **Unauthorized citation rate** — must be 0. `engine.search` already raises `IsolationError` for
  Evidence from a Dataset the caller cannot read, so any non-zero count is a bug, not a score.

### 4.4 Safety and operations

Faithfulness to retrieved context, context utilization, and noise sensitivity (all four available
as RAGChecker diagnostics); prompt-injection resistance against `GROUNDING_POLICY`; cross-course
and cross-Tier leakage counts; `latency_ms` p50/p95 per mode; tokens and cost per Turn; failure and
empty-Dataset behaviour per mode. Isolation, injection and Citation-resolution failures are
zero-tolerance gates. Everything else is a tracked number with a threshold set after the pilot.

## 5. How large the set must be

The plan needs a defensible size before anyone spends annotation hours. Simulation, standard
library only, seed 20260923 (`/tmp/eval_power.py`, reproduced in the appendix):

**Absolute precision of one metric** — 95% CI half-width on a per-question score whose true mean is
0.80. "Graded" mixes saturated 0/1 questions with partial-credit ones, which is how claim-level
scores actually distribute:

|   n | Wilson (binary) | bootstrap (graded) |
|----:|----------------:|-------------------:|
|  30 | ±0.139 | ±0.069 |
|  50 | ±0.109 | ±0.102 |
|  75 | ±0.089 | ±0.078 |
| 100 | ±0.078 | ±0.074 |
| 150 | ±0.064 | ±0.055 |
| 200 | ±0.055 | ±0.047 |
| 300 | ±0.045 | ±0.037 |

(The n=30 bootstrap figure is narrower than n=50 because the bootstrap understates spread at very
small n — itself a reason not to report a 30-question result.)

**Comparing two query types on the same questions** — power of the exact paired sign/McNemar test,
α=0.05. "Discordance" is the share of questions where the two modes differ at all:

| discordance | true gap | n=50 | n=100 | n=200 |
|---|---:|---:|---:|---:|
| 20% | 5% | 0.07 | 0.14 | 0.29 |
| 20% | 10% | 0.24 | 0.54 | 0.87 |
| 20% | 15% | 0.59 | 0.93 | 1.00 |
| 30% | 5% | 0.06 | 0.10 | 0.21 |
| 30% | 10% | 0.18 | 0.37 | 0.70 |
| 30% | 15% | 0.39 | 0.76 | 0.97 |
| 40% | 5% | 0.06 | 0.09 | 0.16 |
| 40% | 10% | 0.14 | 0.30 | 0.57 |
| 40% | 15% | 0.32 | 0.62 | 0.91 |

Read off the consequences:

- **50 questions** buys roughly ±0.10 on any single metric and almost no ability to rank the four
  modes. Adequate for a pilot that shakes out the harness; not adequate for a launch claim.
- **100 questions per course** is the recommended pilot target: ±0.07 absolute, and it detects a
  15-point gap between two modes with ~0.8 power. Enough to pick a default retrieval mode if the
  modes differ substantially.
- **200+ questions** is what "GRAPH beats HYBRID by 10 points" requires. Below that, do not make
  ranking claims about the modes at all.
- No realistic set size detects a 5-point difference between modes. Treat sub-5-point gaps as ties
  and decide on latency and cost instead, which the same run already measures.

Per-kind subgroup reporting divides these n's by the share in §3.1, so a 100-question set gives
only ~10 `unsupported` questions — enough to catch a broken abstention path, not enough to quote a
hallucination rate. Report subgroup numbers with counts, never as bare percentages.

Because scores are compared across modes on the same questions, every comparison is paired: use the
paired test, and bootstrap CIs over questions (Cognee's `eval_framework` already ships bootstrap CI
reporting in `analysis/`, which is reusable as a pattern).

## 6. Procedure

1. **Freeze a snapshot.** Pin a Material set per course, Cognify it, record the Cognee version,
   embedding model, LLM, `top_k` and prompt hashes with the run. A run whose config is not recorded
   is not comparable to the next one.
2. **Run each question through all four modes** with the same session semantics as `/ask`, one
   fresh Session per question so conversation history cannot leak answers between questions.
3. **Capture** answer text, every `TierResult` and its `Evidence`, `cited_chunk_ids`, `used_notes`,
   `latency_ms`, tokens/cost, and any exception, as one JSONL row per (question, mode).
4. **Judge** with the LLM judge for claim extraction, claim entailment and Citation entailment;
   have humans label a stratified 15–20% subsample of the same rows.
5. **Validate the judge** before trusting it: report judge-vs-human agreement per metric. MT-Bench
   found GPT-4 judges reach >80% agreement with human experts, the same level as human–human
   agreement, but also documents position, verbosity and self-enhancement biases
   ([arXiv:2306.05685](https://browse.arxiv.org/html/2306.05685v4),
   [NeurIPS](https://proceedings.neurips.cc/paper_files/paper/2023/file/91f18a1287b398d378ef22505bf41832-Paper-Datasets_and_Benchmarks.pdf)).
   Mitigations to apply: never let the judge score its own family's output without a human check on
   that subsample, randomise presentation order, and judge one claim at a time rather than ranking
   whole answers.
6. **Repeat** a 20-question subset three times to quantify run-to-run variance. Report that spread;
   any mode difference smaller than it is noise.
7. **Aggregate** per mode, per question kind and per course, with bootstrap CIs and paired tests.

## 7. Reporting

One table per run: rows = the four modes, columns = AnswerP/R/F1, retrieval P@k/R@k/MRR, Citation
precision/recall/resolution/Page accuracy, correct-abstention, hallucination, p50/p95 latency, cost
per Turn — every cell with a CI, and the isolation/injection/resolution gates as pass/fail rather
than scores. Plus a per-kind breakdown with counts, a paired-comparison table between modes, and an
error taxonomy with worked examples: retrieval miss, retrieval hit but answer miss, unsupported
claim, missing Citation, wrong-Page Citation, redundant Citation, wrong abstention, missed
abstention, graph-Citation noise, isolation failure.

Artifacts per run: golden JSONL, annotation guide, raw outputs JSONL, per-question scores, the
aggregate report, and the config manifest.

## 8. Phasing

- **Phase 0** — Fix the golden-set schema, write the annotation guide and judge rubrics, decide
  Option A vs Option B for statement-level Citations. No code.
- **Phase 1** — Pilot: one course, 100 questions, two annotators, all four modes. Output is a
  baseline plus a list of harness defects; thresholds are set *from* this, not before it.
- **Phase 2** — Expand to 200+ per course and 2–3 courses; add the private-Tier questions that
  exercise Notes and the Tier merge.
- **Phase 3** — Run as a regression gate on every retrieval, prompt or model change, with the
  zero-tolerance gates in CI and the quality metrics tracked as trends.
- **Phase 4** — Sample production Turns and join against the existing `Feedback` thumbs; the
  reference-free Ragas metrics work here, the gold-Chunk ones do not.

## 9. Risks and limitations

- **The existing canary is not this.** `server/tests/test_study_evaluation.py` is gated on
  `LATTICE_RUN_STUDY_EVAL=1`, uses one tiny synthetic Material, and has no gold claims or gold
  Chunks. AGENTS.md already says it "does not substitute for real-course quality evaluation". It
  belongs in this plan as a smoke test that the pipeline answers at all, and nowhere else.
- **Cognee's `eval_framework` is not a drop-in.** It supplies useful machinery — benchmark
  adapters, answer generation, DeepEval/DirectLLM evaluators, EM/token-F1/correctness/contextual
  relevancy, bootstrap CI reporting — but its data model is (question, answer, retrieved context).
  It has no notion of Lattice's two Tiers, structured `Evidence`, Chunk/Page identity or isolation,
  so it can back §4.1's secondary metrics and be borrowed from for reporting, while the Citation,
  Page and isolation metrics need a Lattice-specific evaluator.
- **Page attribution will score badly and that is a known open issue (#6), not a finding.** Report
  it separately so it does not contaminate the Chunk-level numbers or the mode comparison.
- **Statement-level Citation precision is not measurable today** (§2.1). Any "Reference precision"
  figure produced under Option A is an upper bound on the guarantee students actually experience.
- **LLM judges drift** across model versions. Pin the judge model and version per run; a judge
  change invalidates cross-run comparison exactly like an embedding change does.
- **Gold Chunk IDs are snapshot-bound.** Re-chunking or re-Cognifying invalidates `gold_chunk_ids`;
  anchor gold to Material + Page ranges as well so the set survives a chunking change.
- **Cost.** Four modes × N questions × repeats × a judge pass is the dominant expense; budget it
  from the per-Material cost baseline in the 20 Sep findings before committing to Phase 2 sizes.

## Appendix: sizing script

The numbers in §5 come from this throwaway simulation, kept here for reproducibility rather than
added to the repo as code. Standard library only.

```python
# /tmp/eval_power.py — bootstrap CI half-width vs n, and paired-test power.
# Full source used for this note: seed 20260923; 4000 bootstrap draws; 3000 power trials.
# 1. bootstrap_half_width(scores): resample per-question scores, take the 2.5/97.5 percentile
#    spread of the mean, halve it.
# 2. graded_scores(n, mean): 70% saturated 0/1 questions, 30% partial credit ~ N(mean, 0.25),
#    clipped to [0, 1] — the shape claim-level per-question scores take.
# 3. wilson_half_width(n, p): closed-form Wilson interval, the binary baseline.
# 4. mcnemar_power(n, discordance, delta): exact binomial sign test on discordant pairs,
#    delta split over the discordance, alpha 0.05.
```

## Sources

- RAGChecker, claim-level retriever/generator decomposition: <https://arxiv.org/html/2408.08067>
- ALCE, statement-level citation precision and recall:
  <https://arxiv.org/html/2305.14627>, <https://aclanthology.org/2023.emnlp-main.398/>
- Ragas context precision: <https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/>
- Ragas context recall: <https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/>
- NoMIRACL, hallucination rate and error rate on non-relevant/relevant subsets:
  <https://arxiv.org/html/2312.11361v1>, <https://aclanthology.org/2024.findings-emnlp.730/>
- MT-Bench, LLM-judge agreement and biases: <https://browse.arxiv.org/html/2306.05685v4>,
  <https://proceedings.neurips.cc/paper_files/paper/2023/file/91f18a1287b398d378ef22505bf41832-Paper-Datasets_and_Benchmarks.pdf>
- Lattice source: `server/lattice/retrieval.py`, `server/lattice/study.py`,
  `server/lattice/grounding.py`, `server/lattice/engine.py`,
  `server/lattice/db/models/conversation.py`, `server/tests/test_study_evaluation.py`,
  `app/src/lib/api.ts`, `app/src/lib/references.ts`
- Lattice docs: `AGENTS.md`, `CONTEXT.md`, `docs/wiki/backlog.md` (issue #6)
- Cognee 1.5.4 `cognee/eval_framework/` (installed package): `eval_config.py`, `runner.py`,
  `evaluation/`, `analysis/`, `reporting/`
