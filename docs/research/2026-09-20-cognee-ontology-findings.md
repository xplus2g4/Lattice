# Cognee 1.5.4: ontology and graph-retrieval probe

20 Sep 2026. Python 3.14.7, embedded SQLite/LanceDB/Ladybug, local fastembed; `openai/deepseek-v4-flash` returned `deepseek-flash` (the V4.1 Flash alias). The [probe](../../server/scripts/probe_ontology.py) used isolated datasets and an identical tiny corpus: three Concepts, one Topic and six directed relationships. The [OWL fixture](../../server/scripts/fixtures/course_ontology.owl) contains no individuals or answer facts.

| Variant / archived results | Expected nodes / relationships / type links | Dataset controls | Whole-probe cost upper bound |
|---|---|---|---:|
| [Default](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-ontology-default.json) | 4/4, 6/6, 4/4 | Passed | $0.009755 |
| [Pydantic](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-ontology-pydantic.json) | 4/4, 6/6, 4/4 | Passed | $0.006862 |
| [OWL annotate](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-ontology-owl-annotate.json) | 4/4, 6/6, 4/4 | Passed | $0.010553 |
| [OWL strict](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-ontology-owl-strict.json) | 4/4, 6/6, 4/4 | Passed | $0.008642 |

Controls verified authorized reads, exclusion of another course and principal's private Note, and refusal of a direct unauthorized read. Costs include controls and retrieval at [20 Sep peak/cache-miss rates](https://api-docs.deepseek.com/quick_start/pricing), not invoices or extraction-only costs. Default also produced an extra Concept and relationship outside the target vocabulary; one run does not establish OWL vocabulary enforcement.

| Retrieval mode | Result / limitation |
|---|---|
| `CYPHER` | One/two-hop traversal worked; needs semantic-type/relationship filters, seed exclusion and ranking. |
| `TRIPLET_COMPLETION` | Answered after `create_triplet_embeddings`, but returned no structured evidence; not a stable related-concept list. |
| `GRAPH_REPORT` | Whole-graph summaries, not query-scoped related-concept ranking. |
| `INSIGHTS` | Absent in the pinned version. |

**Conclusion:** prototype with a constrained Pydantic `KnowledgeGraph` schema, explicit semantic validation and dataset-scoped Cypher. Literal fields restrict vocabulary, not relationship direction or endpoint correctness. [OWL strict only grounds entities](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/ontology/construct_data_points_and_edges_with_ontology.py); it does not enforce relationship names or domain/range constraints.

The adapter must map `Entity` nodes through `is_a` links to `EntityType` for Concept/Topic types, and use `contains` for Chunk links. Real-course extraction quality, precision@3, ranking and citation resolution remain unverified (#7); no production ontology or Phase 2 API was adopted.

[Full run notes and implementation pointers](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-cognee-ontology-findings.md) remain at the original commit.
