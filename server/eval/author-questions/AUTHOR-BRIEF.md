# Author brief

The task text given to each per-deck author. Fill `<COURSE>`, `<TAG>`, `<PAGES>` (the deck's page file) and `<OUT>`; the cross-course author gets the variant at the bottom.

## Per-deck author

```
# Target
Deck <TAG> of course <COURSE>: read <PAGES> in full. `===== Page N =====` marks PDF page N;
that N is the page number you cite. Output: <OUT> (JSON). Nothing else is edited.

# Change
Write 12 evaluation questions about this deck: 5 factual, 2 definition, 1-2 formula,
2 comparison, 2 procedural (drop formula to 1 and add a factual if the deck has no formulas).
Each question must be answerable from the text of one to three pages of this deck and nowhere
else in the deck; prefer facts the deck states in its own words (names, numbers, orderings,
policies), not general knowledge the deck happens to mention.

Rules:
- Ask for exactly what the key facts list. A "who and when" question has two key facts; do
  not add the definition of the thing as a third. Key facts are what a complete answer must
  state, in the deck's wording; a fact that only restates the question's premise is not a key
  fact.
- `reference` is the correct answer in the deck's wording and figures, two to four sentences.
- `gold_pages`: every page the answer needs, `required: true` for those a complete answer
  cannot do without. One page for factual and definition; two or three for comparison and
  procedural when the material spans pages.
- Text absent from the page file (figures, diagrams, images) is invisible to retrieval: never
  target it. If a page is empty in the file, treat it as blank.
- Vary the wording: name the concept the way a student would ("the write policy that only
  updates the cache"), not by quoting the slide title.

Output shape, one file:
{"questions": [{
  "id": "<TAG>-Q01", "deck": "<TAG>", "type": "factual",
  "question": "...", "reference": "...",
  "key_facts": ["...", "..."],
  "gold_pages": [{"deck": "<TAG>", "page": 16, "required": true}]
}]}

# Acceptance
Valid JSON at <OUT> with 12 questions, ids <TAG>-Q01..Q12, every gold page within the deck's
page count and non-empty in the page file, every key fact something the question actually asks
for. Skip formatters, linters and tests.
```

## Cross-course author

```
# Target
Course <COURSE>: read every page file under <PAGES_DIR> (one per deck, `===== Page N =====`
marks PDF page N). Output: <OUT> (JSON). Nothing else is edited.

# Change
Write 6 cross-lecture questions and 10 unanswerable questions.

Cross-lecture (`type: "cross_lecture"`, ids X-Q01..Q06, `deck: "CROSS"`): each needs facts
from two different decks to answer; `gold_pages` name pages in both decks, at least one
`required` per deck. Same rules for reference and key facts as a per-deck question: key facts
only for what is asked, in the decks' wording.

Unanswerable (`type: "unanswerable"`, ids U-Q01..Q10, `deck: "CROSS"`): topics a student of
this course would plausibly ask about that none of the decks cover. For each, list
`absent_terms`: 3-6 distinctive terms (names, acronyms, phrases) whose absence from every page
file proves the topic is absent; search the page files case-insensitively and drop any term
that occurs. `gold_pages` is `[]`, `key_facts` is `[]`, `reference` is
"Not covered in the course materials."

# Acceptance
Valid JSON at <OUT>, 16 questions, every absent term genuinely absent from every page file,
every cross-lecture question citing pages in two decks. Skip formatters, linters and tests.
```
