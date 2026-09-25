---
name: author-questions
description: Author the evaluation question set for a course from its seed decks. Use when asked to generate, regenerate, or extend `eval/<COURSE>/questions.json`, or to add questions for a new deck.
---

Produce `server/eval/<COURSE>/questions.json`: one question set the evaluation harness (`server/eval/eval_course.py`, steps in `server/eval/README.md`) runs against the course's seed PDFs. Every question is anchored to PDF page numbers, because the retrieval metrics compare cited pages to `gold_pages`; a wrong gold page silently poisons them, so the human reviews every item before any paid run.

All commands from `server/`. Scratch output goes under `.scratch/eval/<COURSE>/` (ignored).

## 1. Extract pages

```sh
uv run python eval/author-questions/extract_pages.py <COURSE>
```

Writes `.scratch/eval/<COURSE>/pages/<tag>.txt` per deck with `===== Page N =====` markers, plus `decks.json`. The text is what Cognee's loader sees, so anything missing here is missing from retrieval. Read the inventory: decide which decks are in scope (course-admin decks are out; they get no questions and the harness then ignores them) and note decks with many empty pages (figure-heavy; fewer questions).

Done when: a page file exists for every in-scope deck and you have read the inventory.

## 2. Author in parallel

One `task` subagent per in-scope deck plus one cross-course author, in a single batch, each given the brief from [`AUTHOR-BRIEF.md`](AUTHOR-BRIEF.md) with its placeholders filled. Output files go to `.scratch/eval/<COURSE>/drafts/<tag>.json` and `CROSS.json`. Authors read only their page file (the cross author reads all of them) and write only their output; no validation runs mid-batch.

Extending an existing set (new deck, more questions of one type): dispatch only the authors needed, with ids continuing the existing numbering, and put the new drafts beside a copy of the existing questions split back into per-deck files.

Done when: every author has yielded and every expected draft file exists.

## 3. Merge and check

```sh
uv run python eval/author-questions/merge_questions.py <COURSE>
```

Refuses to write on any error: bad ids, duplicate ids, gold page out of range or on an empty page, cross-lecture question citing one deck, unanswerable question whose "absent" term occurs in a deck, empty key facts. Fix the draft (or send the author back with the error line) and re-run. Warnings flag key facts that restate the question; fix those by hand in the draft, they are the defect the trial found (`docs/research/2026-09-24-cs4223-trial-findings.md`).

Done when: the script writes `eval/<COURSE>/questions.json` with `reviewed: false` on every item and prints the type and deck counts, and the counts match what was commissioned.

## 4. Hand off for review

Tell the human where the file is, the counts, and any warnings you could not resolve. The human sets `reviewed: true` per item against the seed decks; the harness runs only reviewed items. Nothing in this skill flips the flag.

## Question contract

Reference for authors and checkers; the brief restates the parts each author needs.

| Field | Rule |
|---|---|
| `id` | `<TAG>-Q<NN>`; `X-Q<NN>` cross-lecture; `U-Q<NN>` unanswerable |
| `deck` | the deck tag, or `CROSS` |
| `type` | `factual`, `definition`, `formula`, `comparison`, `procedural`, `cross_lecture`, `unanswerable` |
| `question` | what a student would ask, in their words, not the slide title |
| `reference` | the correct answer in the deck's wording and figures |
| `key_facts` | what a complete answer must state; only what the question asks for; empty for unanswerable |
| `gold_pages` | `[{"deck", "page", "required"}]`, PDF page numbers 1-based, ≥1 required; two decks for cross-lecture; empty for unanswerable |
| `absent_terms` | unanswerable only; terms proven absent from every deck |
| `reviewed` | written `false`; the human's flag |

Default mix for a course: 12 per deck (5 factual, 2 definition, 1–2 formula, 2 comparison, 2 procedural), 6 cross-lecture, 10 unanswerable.
