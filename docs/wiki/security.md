# Security and trust boundaries

Where trust changes hands, and what enforces each boundary.

```
 untrusted ──────────────┐            ┌────────── semi-trusted ─────────┐   ┌── trusted ──┐
 browser, uploaded files │            │ retrieved chunks, LLM output    │   │ API, worker │
                         ▼            ▼                                 ▼   ▼             │
                      [auth + RBAC]  [data-not-instruction wrapping]  [schema + citation validation]
```

## Identity

The web app runs the Google Authorization Code flow with PKCE and verifies the `id_token` once, at callback. It then holds the identity in an encrypted session cookie and mints a short-lived Lattice JWT (`TOKEN_SECRET`, shared web↔API) that the browser sends as `Authorization: Bearer`; the API verifies it locally, no Google call on the hot path. A verified Google identity alone is not enough — the email must already exist in `users` or be redeemed through a single-use Invite (instructor/admin-minted; the first login matching `INSTRUCTOR_EMAIL` bootstraps). `DEV_HEADER_AUTH` keeps the `X-User` path for tests and local dev. Cognee principals are derived from the `users` table, never from request input.

## Tenant isolation

Enforced twice ([ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md)): Cognee dataset permissions (backend access control), and an API-level check that every result and every citation names a dataset the caller may read. The second is `IsolationError` in `lattice/engine.py`; it raises rather than filtering, because a result from an unexpected dataset means something below the API is wrong and no part of that answer can be trusted, so `/ask` returns 502. There is deliberately no default tier: an unrecognised `dataset_id` is refused, not labelled `course`.

`tests/test_canary.py::test_private_notes_never_leak` exercises both layers end to end against real Cognee, and `tests/test_isolation.py` covers the API-level check exhaustively without spending LLM calls.

The Related-course lane of `/ask` ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)) searches other courses' global datasets as the instructor principal, not the caller's. That principal owns every global dataset and no private one, so a Note is out of its reach by construction; each lane passes a datasets map holding only that course's global dataset, so the same `IsolationError` check refuses anything else, the caller's own datasets included. Student principals gain no permissions: what they may read is still exactly their Enrolments. A Related-course reference opens that course's reader in a new tab, and the reader still checks Enrolment, so the link reaches nothing the course page would not.

## Indirect prompt injection

Materials and Notes are untrusted text. `lattice/retrieval.py` wraps the retrieved context (including graph-derived text) in an escaped `<retrieved_context trust="untrusted">` block for `GRAPH_COMPLETION`, `RAG_COMPLETION` and `HYBRID_COMPLETION`. `Engine.search` supplies a grounding instruction that treats that context and previous answers as data, not instructions. The Related-course lane passes `RELATED_POLICY` instead, built in `lattice/grounding.py` from the same guard-rail block plus a length and format instruction, so the two prompts cannot drift apart; `tests/test_ask.py` asserts that lane is given it. `CHUNKS` remains raw retrieval, not an answer-generation path.

`tests/test_prompt_boundary.py` exercises the actual Cognee search and prompt path with controlled external storage and LLM responses. It checks escaping, all three completion modes, Hybrid's Graph fallback, empty context and follow-up history. These deterministic checks validate prompt construction, not model compliance.

`tests/test_canary.py::test_retrieved_instructions_do_not_override_grounded_answers` ingests a small poisoned Markdown Material and Note through the API, verifies they reach `ready`, observes that the injected text reaches generation, and checks grounded answers, a follow-up and an unsupported question. The current API has no `not_covered` field: the grounding instruction requests the text "Not covered by the supplied materials." Both live canaries passed locally on 20 Sep 2026 against Cognee 1.5.4 and the configured `deepseek-v4-flash` alias (the provider returned `deepseek-flash`). The new test is selected by the existing `canary` CI job; CI still skips without the repository secret (#14).

This is a mitigation, not proof against arbitrary prompt injection or knowledge poisoning during Cognify. Cognee still owns session-history formatting and can place history in the system prompt; wrapping current retrieval does not structurally isolate that history. The adapters retain Cognee's sequential session path, rather than its exact-built-in-class-only concurrent path. Citation handling and dataset checks are unchanged. In this pin, Hybrid can append textual references without returning structured evidence; that existing limitation is not repaired by prompt wrapping.

## Output validation

The LLM returns a schema-constrained `Answer`. The API drops unresolvable citations and strips HTML and links before anything reaches the client.

## Abuse limits

Per-user asks/min; upload size and type limits; instructor-only upload endpoints. The daily Spend limit is the deployment-wide Ceiling, not a per-Principal budget: see [operations.md](./operations.md#telemetry-and-alerts) for what refuses at 100 %.

## Egress

The rule: aggregates may leave the VM; content and identities never do. Materials, Notes, questions, answers, emails and user ids stay in the app Postgres, the Cognee stores and the GCS bucket, all inside the deployment. The LLM and embedding providers are the disclosed exception ([Privacy](#privacy)); nothing else receives content.

The only analytics third party is GA4, and it receives page views alone: one hit per client navigation keyed by the route id, such as `/courses/$course/`, with no path parameters. The route id is sent in both `page_path` (`dp`) and `page_location` (`dl`, as origin plus route id), because gtag otherwise fills `dl` from `document.location`; so the real URL with its course uuid, Material id or Note id never leaves the browser. No user id is set, no custom events are sent, and `/dev` and `/foundation` routes never report. The script loads only when the app is built with `VITE_GA_MEASUREMENT_ID`; unset, no `gtag` tag exists. A consent banner is owed before real students use the app; until it exists, leave the measurement id unset on any deployment students reach.

Product events (`product_events`, [data-model.md](./data-model.md)) carry the Principal's `user_id` and a course id. `ask.asked` records the question's length and its sha256, never the text; no event stores Material, Note, question or answer content. They are written by the API in the action's own transaction and never leave the app Postgres.

Telemetry labels carry a course at most: route, status, model, kind, outcome and course id, never a user id. `/metrics` is a 404 unless `METRICS_TOKEN` is set, and then needs that bearer token.

## Privacy

`notes_opt_out` is applied server-side in step 2 of `/ask` ([flows.md](./flows.md)). Account deletion removes private datasets. Raw files stay in a private bucket. Third-party LLM usage is disclosed on the landing page.
