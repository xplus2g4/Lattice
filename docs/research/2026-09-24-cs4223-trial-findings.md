# CS4223 evaluation trial: seven questions at chunk size 2,048, GRAPH_COMPLETION

24 Sep 2026. First paid run of the harness described in the [evaluation design](./2026-09-23-cs4223-evaluation-design.md): course `cs4223c2048`, the seven seed decks L01–L06 cognified at `chunk_size=2048`, one factual question per deck, `GRAPH_COMPLETION` only, judged by `gpt-6-sol`. `openai/deepseek-v4-flash` answers, `openai/text-embedding-3-small` embeds. Run record: [`2026-09-24-cs4223-trial-cs4223c2048-graph.json`](./2026-09-24-cs4223-trial-cs4223c2048-graph.json) (the working copy under `server/eval/CS4223/runs/` is ignored).

## Result

| Metric | Value | Reads as |
|---|---|---|
| Material-hit | 7/7 | the right deck was cited every time |
| Page-containment / Page-precision / MRR | 0 / 0 / 0 | structural: GRAPH segment Evidence carries no page span (below) |
| Acceptable | 7/7 | correctness 2 on all seven; completeness 2 ×4, 1 ×3 |
| Faithfulness | unscored ×7 | no cited page text to check against |
| False abstention | 0/7 | |
| Latency p50 / p95 | 3.3 s / 4.4 s | |
| Tokens per ask | 6,273 in / 50 out | ≈ US$0.002 at peak DeepSeek rates |
| Cognify, 7 decks, 31 Chunks | 123,786 in / 681,121 out ≈ US$0.85 | the estimate said US$0.40 (below) |

Answers used the decks' wording, not the textbook's: "the course notes call it 'true dependency or RAW dependency'"; Flynn dated 1972 as the slide has it; Tomasulo's three ideas in the slide's phrasing.

## The gold Chunk was cited every time

Reading each cited `chunk_index` back against the `cs4223c2048-global` LanceDB `DocumentChunk_text` rows gives the page range each Chunk covers (from the loader's `Page N:` labels). At 2,048 tokens the decks became 3–7 Chunks each (L03: 7; L05: 2). For every question, one of the cited segments was the Chunk holding the gold page:

| Question | Gold page | Cited Chunk holding it | Rank in Evidence |
|---|---|---|---|
| L01-Q01 | L01 p16 | L01 chunk 1 = p16–33 | 31 |
| L02a-Q01 | L02a p47 | L02a chunk 3 = p36–50 | 34 |
| L02b-Q01 | L02b p11–12 | L02b chunk 1 = p8–16 | 36 |
| L03-Q01 | L03 p74 | L03 chunk 6 = p74–82 | 30 |
| L04-Q01 | L04 p4 | L04 chunk 0 = p1–13 | 32 |
| L05-Q01 | L05 p10, p14 | L05 chunk 0 = p1–13, chunk 1 = p14–23 | 29 |
| L06-Q01 | L06 p21–22 | L06 chunk 2 = p21–27 | 31 |

So retrieval at 2,048 is 7/7 at Chunk level and the page columns read 0 only because `Evidence.page_start`/`page_end` are `None` for graph segments: Cognee's GRAPH `objects_result` holds triplets, not chunk text, so the product's `_page_span` regex has nothing to read. The product does receive `chunk_id` and `chunk_index`, and Cognee's store holds the chunk text with its page labels. That is the concrete shape of backlog #6: resolve pages from the chunk record rather than from whatever text the search type happens to return. Until then, read GRAPH on Material-hit and answer quality; RAG and HYBRID are where page numbers surface.

Two other things the ranks show. Segments sit at ranks 29–45 of 33–45 items, always behind 15 graph nodes and 15 edges, so MRR over the Evidence list is ≈ 0.03 for GRAPH even when the gold Chunk is cited; MRR is a RAG/HYBRID metric. And cross-deck segments are common (L02b-Q01 cited ten segments from five decks), which is expected of a course-wide graph but would make a student-facing citation list noisy.

## Dataset defect: key facts that restate the question

The three completeness-1 grades are not answer failures. L04-Q01 asks "who and when"; "M. Flynn, 1972" is complete, and the missed key fact ("classifies by instruction and data streams") is the question's own stem. L05-Q01 asks "what acronym"; the missed fact ("multiple threads issued per cycle") is the question's premise. L02a-Q01 (RAW) is the same pattern. Key facts should list only what the question asks for; short-answer questions across the set need that pass before the full run, or Completeness is systematically depressed on exactly the questions the system gets right.

## Estimate calibration

The estimate assumed 4 characters per token and predicted 16 Chunks at 2,048; the real count was 31. Slide text (symbols, tables, `Page N:` labels) tokenises at roughly 2 characters per token, so cognify cost came in at 2.1× the quote and ask context at 8,191 will be heavier than quoted too. `CHARS_PER_TOKEN` in `eval/eval_course.py` should be halved from this measurement.

## The design not taken: a perturbed corpus

The first cut of this evaluation ran every question on two courses, the real decks and a copy with names, formulas and claims changed (MESI → MOSKI, Moore → Kellner, Amdahl → Halden, the 18-month doubling → 30 months), to separate "retrieved from the deck" from "recalled from the textbook": an answer giving the real name on the perturbed course would be a memorisation leak, and the leak rate would qualify every answer-quality number. The trial against those decks (seven questions, one per lecture, on the earlier `bge-small` embedding) is what led to dropping it:

- The model recognised the description and answered with the real name. Asked about the doubling prediction on decks that said "Kellner's Law", the answer came back "Moore's Law". Rather than measuring retrieval, the perturbed course measured how strongly a well-known fact overrides a contradicting context, which every capable model does and which a course assistant should arguably do when the slide is wrong.
- The perturbed decks were text-only regenerations of the extracted page text, not the PDFs the product ingests. Every result on them was one step removed from the product; two variants doubled the cognify and judge cost for a number that did not transfer.
- The judge had to be told the reference overrides real-world truth, and the eight "injected fact" questions had no counterpart in the real course, so those answers could not be compared across variants at all.

What replaces it is weaker but honest: retrieval metrics do not depend on the answer text, so they measure retrieval regardless of what the model already knows; faithfulness is judged only against cited page text, so an answer that is right from memory but cites the wrong page still loses; and the key-facts checklist ties correctness to the deck's wording and figures. What is lost is a direct number for "would the answer have been right with no retrieval at all". A cheaper way to get that, if it is wanted later, is a no-retrieval baseline: ask the same 100 questions with the context empty and judge them the same way. The gap between that and the retrieved run is the value retrieval adds, with no corpus editing.
