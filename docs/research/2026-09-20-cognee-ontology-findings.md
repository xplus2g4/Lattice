# Cognee 1.5.4: ontology and graph-retrieval probe

20 Sep 2026. Python 3.14.7, embedded SQLite/LanceDB/Ladybug, local fastembed embeddings. Configured model: `openai/deepseek-v4-flash`; provider responses report `deepseek-flash`. The [official API documentation](https://api-docs.deepseek.com/) says the legacy alias now serves V4.1 Flash. This is a mechanism check on a tiny synthetic course, not a real-course quality evaluation or a new production decision.

## Method and evidence

[`server/scripts/probe_ontology.py`](../../server/scripts/probe_ontology.py) runs each variant in a fresh temporary store with explicit principals and dataset UUIDs. The identical corpus declares three Concepts (`BaseCase`, `Recursion`, `StackFrames`), one Topic (`Week3`), and six directed relationships. Its SHA256 is recorded in every result. The [OWL fixture](../../server/scripts/fixtures/course_ontology.owl) declares classes and property domains/ranges, but **no individuals or answer facts**, so it cannot supply the expected answers by itself.

The Pydantic variant subclasses Cognee's `KnowledgeGraph`, restricting node types and relationship names with `Literal`. It is not a custom `DataPoint` storage model. The `node_schema` and `edge_schema` fields in the result artifacts describe this target vocabulary; they do not mean those constraints were applied to the default or OWL variants.

| Variant / raw results | Expected nodes | Expected relationships | Expected type links | Dataset controls | Full probe cost upper bound |
|---|---:|---:|---:|---|---:|
| [Default](./2026-09-20-ontology-default.json) | 4/4 | 6/6 | 4/4 | Passed | $0.009755 |
| [Pydantic](./2026-09-20-ontology-pydantic.json) | 4/4 | 6/6 | 4/4 | Passed | $0.006862 |
| [OWL annotate](./2026-09-20-ontology-owl-annotate.json) | 4/4 | 6/6 | 4/4 | Passed | $0.010553 |
| [OWL strict](./2026-09-20-ontology-owl-strict.json) | 4/4 | 6/6 | 4/4 | Passed | $0.008642 |

Each probe also Cognified a second course and another principal's private Note. Positive controls retrieved their distinctive Concepts through authorized reads. The current-course query excluded both; directly naming the private dataset as the other principal raised `PermissionDeniedError`. These test Cognee's graph-query permissions, not a new HTTP endpoint.

Costs include the control datasets and retrieval checks, not just the main corpus. The four probes together have a $0.035812 upper bound at the verified peak cache-miss/input and output rates. The [pricing table](https://api-docs.deepseek.com/quick_start/pricing) offers lower off-peak/cache-hit rates; these figures are deliberately conservative, not invoices. All request reservations were resolved. The operation records include both initiation and terminal rows: use terminal rows once per `pipeline_run_id`, and do not treat null usage as measured zero.

## What the graph actually stores

In all variants, Concepts and Topics are physically `Entity` nodes. Their semantic types are `is_a` links to `EntityType` nodes named `concept` or `topic`. Code selecting `node.type == "Concept"` would therefore miss them. Chunks link through `contains`, not the wiki's conceptual `mentions` edge. Both mappings need to be explicit in a future related-concept adapter.

The default extraction also added `active function calls` and a `stores_state_of` relationship, supported by the final sentence of the corpus but outside the four-name target vocabulary. The other three runs retained the six expected domain relationships without that addition. One sample does **not** establish that OWL enforces the relationship vocabulary.

In particular, Cognee's pinned [ontology implementation](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/ontology/construct_data_points_and_edges_with_ontology.py) explicitly makes strict mode **entity grounding only**: it retains a node when either its type matches an ontology class or its name matches an individual. It does not validate relationship names or perform domain/range, cardinality or disjointness reasoning. This limitation is source-verified, not a claim that the live fixture generated a domain/range violation.

## Retrieval modes

- **CYPHER:** one- and two-hop queries worked on the pinned Ladybug backend. Rows are positional tuples, so the probe maps columns explicitly. Raw traversal includes `EntityType`/Topic nodes, and two hops can return the seed Concept again through a cycle. A product query needs semantic-type and relationship filters, seed exclusion and ranking. Unlabelled node queries also returned null-valued bookkeeping rows; use the actual `Node`/`EDGE` labels for production queries.
- **TRIPLET_COMPLETION:** worked after the explicit `create_triplet_embeddings` memify step. All four variants answered that BaseCase is a prerequisite of Recursion. Returned structured evidence was empty in these runs. A fluent answer is not a stable neighbor list or a sufficient citation mechanism.
- **GRAPH_REPORT:** returned whole-graph hub/provenance summaries and LLM-suggested questions. It included `week3`, `concept` and `topic` among hubs; reported PageRank values were zero in this environment. This is not a query-scoped related-concept ranking.
- **INSIGHTS:** absent from the pinned search-type vocabulary; it is not an implementation candidate.

Primary implementation pointers: [triplet retriever and its prerequisite](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/retrieval/triplet_retriever.py), [graph report](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/retrieval/graph_report_retriever.py), and [Cypher retrieval](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/retrieval/cypher_search_retriever.py). Runtime observations are in the linked JSON artifacts; source references use the public v1.5.4 tag's commit.

## Recommendation and limits

For a Phase 2 prototype, prefer **a constrained Pydantic extraction schema plus explicit semantic validation**, followed by dataset-scoped Cypher traversal. Literal fields constrain vocabulary, but do not themselves establish correct relationship direction or endpoint types. Treat OWL as reference-vocabulary enrichment unless an additional validator supplies the constraints the application needs.

This removes the uncertainty about whether the pinned engine can store and traverse these relationships. It does not settle extraction quality, precision@3, stable ranking, citation resolution, or behavior on a real course ontology. No production ontology, public Cypher endpoint, related-concept API, graph-store change or ADR was introduced. Issue #7 has concrete evidence for a format/retrieval decision, but the broader Phase 2 quality risk in ADR 0006 remains.
