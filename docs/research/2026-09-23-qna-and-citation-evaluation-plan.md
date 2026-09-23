# Evaluating Lattice: retrieval, answer, Citations

Point-in-time research, 23 Sep 2026. A plan, not an implementation.

Scope: three layers, measured separately, because they fail independently. A correct answer over bad
retrieval means the model answered from memory and will not generalise to the next course; good
retrieval with a wrong answer is a generation problem; a right answer with a wrong Page badge is a
product defect, because the student clicks that badge. RAGChecker's retriever/generator split is the
same decomposition ([arXiv:2408.08067](https://arxiv.org/html/2408.08067)).

Out of scope here: isolation and prompt-injection (already canaried per run), cost and latency
(recorded, not analysed).

## 1. The four modes, plus baselines

`server/lattice/study.py`:

```python
QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
```

| Mode | What it does | Why it is in the matrix |
| --- | --- | --- |
| `RAG_COMPLETION` | Vector search over Chunks → LLM answer | Plain RAG reference point |
| `GRAPH_COMPLETION` | Entity/relation traversal of the Cognify graph → LLM answer | Does the graph earn its Cognify cost? |
| `HYBRID_COMPLETION` | Chunk lane + entity lane + fact lane merged → LLM answer | Current default candidate |
| `CHUNKS` | Retrieval only, no generation | Clean retrieval upper bound: what the other three *could* have answered from |

Wired in `server/lattice/grounding.py` (`_RagRetriever`, `_GraphRetriever`, `_HybridRetriever`,
all `top_k=15` by default).

Two baseline arms answer "is Lattice better than just calling the model?":

- **B0 — direct model.** Same question, same LLM, no retrieval and no course context. Scores the
  model's parametric knowledge of the course topic.
- **B1 — context stuffing.** Same question with the whole relevant Material pasted into the prompt,
  where it fits the context window. The strongest non-RAG competitor, and cheap to add.

B0 and B1 produce no Citations, so they are scored on retrieval-free answer metrics only. Six arms
total per question.

## 2. Evaluation dataset: perturbed seed Materials

Chen provides seed Materials per course. The dataset is built by **editing known facts in those
Materials and asking questions only the edited text can answer.** This is Longpre et al.'s
knowledge-conflict construction — substitute entity mentions in the gold document so the contextual
answer contradicts the memorised one, then measure whether the model reads or recites
([ACL 2021](https://aclanthology.org/2021.emnlp-main.565/), [PDF](https://aclanthology.org/2021.emnlp-main.565.pdf)).

Why this method is worth the editing effort:

1. **It separates retrieval from memory.** The pre-training answer and the snapshot answer differ,
   so an answer can be attributed. B0 should score near zero on perturbed questions; if it does
   not, the question was guessable and is cut.
2. **Gold labels come free from the edit log.** We know which Material, which Page, and which text
   span was changed, so `gold_pages` and the expected answer need no annotation — only human
   *verification*.
3. **Detection is cheap.** A distinctive perturbed value can be string-matched, so grounding is
   checkable before any LLM judge runs.

### 2.1 Perturbation types

| Type | Edit | Question it creates |
| --- | --- | --- |
| Value swap | Numbers, dates, thresholds → distinctive new values | "What is the X threshold?" — answerable only from the snapshot |
| Term rename | Rename a concept to a coined course-specific term | Tests retrieval on vocabulary absent from pre-training |
| Relation swap | "A causes B" → "A causes C" | Tests graph modes specifically |
| Insertion | Add a fact that exists nowhere in pre-training (a policy, a made-up lemma) | No memorised competitor at all; pure retrieval |
| Deletion | Remove a fact, then ask about it | Correct behaviour is the abstention string; catches answering from memory |

Rules: every perturbation must be **plausible** (the model must not reject it as absurd),
**internally consistent** (propagate the edit to every occurrence in the snapshot, or the Materials
contradict themselves and Citation gold becomes ambiguous), and **localised** to a recorded Page
range.

### 2.2 Set composition

50 questions per course, 2 courses, 100 total.

| Slice | Share | Purpose |
| --- | --- | --- |
| Perturbed single-fact | 40% | Unambiguous retrieval + Citation gold |
| Perturbed multi-hop / comparison | 15% | Needs two edited spans, often two Materials |
| Deletion → unsupported | 15% | Abstention, and memory-leak detection |
| Unperturbed application / reasoning | 20% | Realistic difficulty; perturbation alone over-weights lookup |
| Unperturbed paraphrase | 10% | Student vocabulary ≠ Material vocabulary |

The unsupported slice is not optional. NoMIRACL shows how badly abstention is distributed — over
88% hallucination rate on non-relevant passages for some models, while models that abstain readily
reach a 74.9% error rate on the relevant subset — so both sides must be scored together or
always-abstain wins ([arXiv:2312.11361](https://arxiv.org/html/2312.11361v1),
[ACL](https://aclanthology.org/2024.findings-emnlp.730/)).

### 2.3 Record format

```json
{
  "id": "cs2100-q017",
  "course": "CS2100",
  "slice": "perturbed_single_fact",
  "question": "How many bits does the widening stage of the pipeline extend to?",
  "perturbation": {"type": "value_swap", "from": "32", "to": "47",
                   "material": "week03.pdf", "pages": [12]},
  "gold_answer": "47 bits.",
  "gold_claims": ["The widening stage extends to 47 bits."],
  "gold_pages": {"week03.pdf": [[12, 12]]},
  "answerable": true,
  "snapshot": "2026-09-23-cs2100-perturbed",
  "verified_by": "human",
  "guessable_by_b0": false
}
```

`gold_claims` is the unit that makes answer precision and recall meaningful for prose answers; token
F1 and exact match cannot tell a complete answer from a verbose one.

### 2.4 Human verification

Cheap, because the edit log supplies the gold. Per question a human confirms: the question is
answerable from the snapshot alone; `gold_answer` and `gold_claims` match the edited text;
`gold_pages` lists every Page containing the fact; the question is not guessable without the
Material (cross-checked against the B0 run). Questions failing any check are cut, not repaired.

Deletion-slice questions get one extra check: the fact is absent from the *whole* snapshot, not just
its original Page.

## 3. Metrics

Notation: generated claims \(G\), gold claims \(Y\), retrieved Chunks \(R_k\), gold Chunks \(G_R\),
Chunk Citations returned \(C\).

### 3.1 Retrieval

\[
\text{P@k}=\frac{|R_k\cap G_R|}{|R_k|}\qquad
\text{R@k}=\frac{|R_k\cap G_R|}{|G_R|}\qquad
\text{MRR}
\]

Gold Chunks are the Chunks overlapping the perturbed span, resolved once per snapshot. Because Chunk
identity dies on re-Cognify, anchor gold to Material + Page range too and derive Chunk IDs from it.

Also report Ragas **context precision** (are relevant Chunks ranked above irrelevant ones) and
**context recall** (share of reference-answer claims attributable to retrieved context) — both
reference-free, so they extend to production sampling later
([precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/),
[recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/)).

### 3.2 Answer

\[
\text{Precision}=\frac{|\{g\in G:\ \text{supported by the snapshot}\}|}{|G|}\qquad
\text{Recall}=\frac{|\{y\in Y:\ \text{covered by } G\}|}{|Y|}\qquad
F_1
\]

Claim extraction and entailment by LLM judge, human-checked on a subsample (§4). Token F1 and exact
match stay as cheap secondary signals — they are what Cognee's bundled `eval_framework` already
computes (`evaluation_metrics = ["correctness", "EM", "f1"]`) — but do not gate on them.

Perturbation adds two metrics the plan is really built for:

- **Grounded-answer rate** — answer states the perturbed value. Retrieval won.
- **Memorised-answer rate** — answer states the original, pre-perturbation value. Memory won; this
  is Longpre's memorisation ratio and it is the headline number distinguishing Lattice from B0.

Plus **correct-abstention rate** and **hallucination rate** on the deletion slice.

### 3.3 Citations — Page-lenient

Per Chen: a Citation passes if the Page it points to contains the relevant fact. Chunk identity and
which sentence the Citation is attached to do not matter.

\[
\text{CitationPrecision}=\frac{|\{c\in C:\ \text{span}(c)\cap\text{gold\_pages}\neq\varnothing\}|}{|C|}
\qquad
\text{CitationRecall}=\frac{|\{g\in G_{\text{ext}}:\ \exists c\in C\ \text{on a Page containing } g\}|}{|G_{\text{ext}}|}
\]

\(G_{\text{ext}}\) = claims needing external evidence, excluding restatements of the question and
hedges. Leniency settles a design question that would otherwise block: `_StructuredReferences` in
`grounding.py` strips Cognee's inline reference block and `Evidence` carries no claim/sentence
field, so per-statement Citation precision in ALCE's sense is not computable on Lattice today
([ALCE](https://arxiv.org/html/2305.14627), [ACL](https://aclanthology.org/2023.emnlp-main.398/)).
Page-level set semantics is exactly what Lattice can produce, so it becomes the spec rather than a
compromise. The cost is stated once and accepted: this cannot catch a Citation attached to the wrong
sentence, and it rewards returning more Citations, which is why redundancy is measured below.

Three companions, reported separately, never folded into the two headline numbers:

- **Citation resolution rate** — share of returned `chunk_id`s that resolve to a live Chunk with a
  `filename` and a non-null Page span. `references.ts` silently drops a Citation with no
  `filename`, so an unresolvable Citation is invisible in the UI. Target 1.0. A Citation with a null
  span cannot be scored leniently and counts as a resolution failure, not a precision failure —
  Page spans are approximate and backlog issue [#6](https://github.com/xplus2g4/Lattice/issues/6)
  is open, so this number is the honest measure of how much of the leniency rule is even applicable.
- **Citation redundancy** — Citations removable without losing Page coverage of any claim. Without
  this, Page-lenient precision is trivially gamed by returning all of `top_k`.
- **Graph Citation usefulness** — `kind` is `chunk | relation | <entity label>`
  (`app/src/lib/api.ts`). Relation and entity Citations have no Page, so they get a human 3-point
  rubric (useful / on-topic but unhelpful / irrelevant) and are excluded from the formulas above.

## 4. Procedure

1. **Build two snapshots per course**: the original Materials, and the perturbed copy. Cognify the
   perturbed copy into its own Dataset, never the real course Dataset. Record Cognee version,
   embedding model, LLM, `top_k` and prompt hashes with the run.
2. **Run all 100 questions through six arms** — four modes plus B0 and B1 — one fresh Session per
   question so history cannot leak answers between questions.
3. **Capture** per (question, arm): answer text, every `TierResult` and its `Evidence`,
   `cited_chunk_ids`, `latency_ms`, tokens, exceptions. All already persisted on `Turn` — no schema
   change needed.
4. **Score** the string-matchable things first (grounded vs memorised value, Citation Page overlap,
   resolution), then run the LLM judge for claim extraction and entailment.
5. **Validate the judge** before trusting it. MT-Bench found GPT-4 judges agree with human experts
   over 80% of the time, matching human–human agreement, but documents position, verbosity and
   self-enhancement bias ([arXiv:2306.05685](https://browse.arxiv.org/html/2306.05685v4)).
   Mitigations: human-label a stratified 20% subsample and report judge-vs-human agreement per
   metric; judge one claim at a time; randomise order; do not let the judge grade its own family's
   output unchecked.
6. **Repeat 20 questions three times** to quantify run-to-run variance. Any arm difference smaller
   than that spread is noise.

## 5. What 50 × 2 can and cannot support

Simulation, standard library, seed 20260923 (`/tmp/eval_power.py`; bootstrap CI on per-question
scores, and exact paired sign test for arm comparisons).

95% CI half-width on one metric, true mean 0.80:

| n | 50 (one course) | 100 (pooled) | 200 |
| --- | --- | --- | --- |
| Wilson (binary) | ±0.109 | ±0.078 | ±0.055 |
| bootstrap (graded) | ±0.102 | ±0.074 | ±0.047 |

Power of the paired test, α=0.05, at 30% discordance between two arms:

| true gap | n=50 | n=100 | n=200 |
| --- | --- | --- | --- |
| 5% | 0.06 | 0.10 | 0.21 |
| 10% | 0.18 | 0.37 | 0.70 |
| 15% | 0.39 | 0.76 | 0.97 |

Consequences, to be stated in the report rather than discovered afterwards:

- **Per course (n=50): ±0.10.** Enough to say "retrieval recall is roughly 0.8", not enough to rank
  the four modes against each other.
- **Pooled (n=100): ±0.07**, and ~0.76 power at a 15-point gap. Enough to pick a default mode *if*
  the modes differ substantially, and enough to compare Lattice against B0, where the gap should be
  large by construction.
- **Sub-5-point gaps between modes are unresolvable** at any realistic size. Call them ties and
  decide on latency and cost, which the same run records.
- **Slices are small.** The 15-question unsupported slice catches a broken abstention path; it
  cannot support a quoted hallucination rate. Report every slice with its count, never as a bare
  percentage.

Every arm is scored on the same questions, so all comparisons are paired: use the paired test, and
bootstrap CIs over questions (Cognee's `eval_framework/analysis/` already ships that pattern).

## 6. Reporting

One table: rows = six arms, columns = retrieval P@k/R@k/MRR, answer P/R/F1, grounded rate,
memorised rate, Citation precision/recall/resolution/redundancy, correct-abstention — each with a
CI, plus a slice breakdown with counts and a paired-comparison table. Error taxonomy with worked
examples: retrieval miss; retrieval hit but answer miss; memorised instead of retrieved; missing
Citation; off-Page Citation; unresolvable Citation; redundant Citation; wrong abstention; missed
abstention.

Artifacts: perturbation edit log, golden JSONL, raw outputs JSONL, per-question scores, aggregate
report, config manifest.

## 7. Limits

- **Perturbation shifts the difficulty distribution.** Distinctive edited values are easier to
  retrieve than genuinely confusable course content, so retrieval numbers on the perturbed slices
  are an optimistic bound. The unperturbed 30% is the corrective and should be reported separately,
  not averaged in.
- **Knowledge conflict is a confound, not just a tool.** A model torn between the snapshot and its
  prior may answer with a blend that is neither the perturbed nor the original value. Score that as
  a third outcome rather than forcing it into grounded/memorised.
- **Page spans are approximate** (issue #6). The leniency rule depends on them, so Citation
  precision is only as trustworthy as the resolution rate reported beside it.
- **Statement-level Citation precision is out of reach today** (§3.3). Page-lenient numbers are an
  upper bound on the guarantee a student actually experiences.
- **Judges and embeddings drift.** Pin both per run; changing either invalidates cross-run
  comparison.
- **The existing canary is not this.** `server/tests/test_study_evaluation.py` is gated on
  `LATTICE_RUN_STUDY_EVAL=1`, uses one tiny synthetic Material, and has no gold claims or Pages.
  AGENTS.md already says it does not substitute for real-course quality evaluation.
- **Cognee's `eval_framework` is not a drop-in.** Its data model is (question, answer, retrieved
  context), with no Tiers, structured `Evidence`, or Page identity, so it can back §3.2's secondary
  metrics and be borrowed from for reporting only.
- **Cost.** Six arms × 100 questions × repeats × a judge pass is the dominant expense; budget from
  the per-Material baseline in the 20 Sep findings before scaling past two courses.

## Sources

- Knowledge conflicts / entity substitution, the dataset method:
  <https://aclanthology.org/2021.emnlp-main.565/>
- RAGChecker, claim-level retriever/generator split: <https://arxiv.org/html/2408.08067>
- ALCE, statement-level Citation precision/recall: <https://arxiv.org/html/2305.14627>,
  <https://aclanthology.org/2023.emnlp-main.398/>
- Ragas context precision / recall:
  <https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/>,
  <https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/>
- NoMIRACL, abstention measured on both subsets: <https://arxiv.org/html/2312.11361v1>,
  <https://aclanthology.org/2024.findings-emnlp.730/>
- MT-Bench, LLM-judge agreement and biases: <https://browse.arxiv.org/html/2306.05685v4>
- Lattice source: `server/lattice/study.py`, `server/lattice/grounding.py`,
  `server/lattice/retrieval.py`, `server/lattice/db/models/conversation.py`,
  `server/tests/test_study_evaluation.py`, `app/src/lib/api.ts`, `app/src/lib/references.ts`
- Lattice docs: `AGENTS.md`, `CONTEXT.md`, `docs/wiki/backlog.md` (issue #6)
- Cognee 1.5.4 `cognee/eval_framework/` (installed package)
