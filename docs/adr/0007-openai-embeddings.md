# Embeddings: OpenAI text-embedding-3-small, not local fastembed

The local `BAAI/bge-small-en-v1.5` model was chosen because DeepSeek has no embeddings API, and it truncates input at 512 tokens while Cognee's default Chunk is 8,191: vector retrieval saw only the head of every Chunk ([evaluation design](../research/2026-09-23-cs4223-evaluation-design.md)). `text-embedding-3-small` takes 8,191 tokens, so the whole Chunk is embedded, at $0.02 per million input tokens: cents per course next to the dollars Cognify spends on DeepSeek. The price is a second provider key and a network hop per batch.

## Consequences

- Dimensions went from 384 to 1,536. Cognee writes the vector width into each Dataset's LanceDB tables, so every existing `COGNEE_ROOT` is invalid: stop the API, delete the root, re-seed. There is no in-place migration.
- The experiment ledger (`scripts/probe_runtime.py`) prices `api.openai.com/v1/embeddings` for this one model and refuses every other OpenAI endpoint; the rate version changed, so older ledgers cannot be reopened.
- The 8,191-token Chunk is now fully embedded but is still a deck-wide citation span; whether to shrink it is what the CS4223 harness measures and what [#6](https://github.com/xplus2g4/Lattice/issues/6) decides.
