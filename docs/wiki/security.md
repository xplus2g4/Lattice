# Security and trust boundaries

Where trust changes hands, and what enforces each boundary.

```
 untrusted ──────────────┐            ┌────────── semi-trusted ─────────┐   ┌── trusted ──┐
 browser, uploaded files │            │ retrieved chunks, LLM output    │   │ API, worker │
                         ▼            ▼                                 ▼   ▼             │
                      [auth + RBAC]  [data-not-instruction wrapping]  [schema + citation validation]
```

## Identity

Google OAuth issues a JWT that the API verifies on every call. Cognee principals are derived from the `users` table, never from request input.

## Tenant isolation

Enforced twice ([ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md)): Cognee dataset permissions (backend access control) and an API-level check that every cited `chunk_id` belongs to a dataset the caller may read. The CI canary test (`test_private_notes_never_leak`) exercises both.

## Indirect prompt injection

Uploaded materials and notes are untrusted text that ends up in the prompt. Chunks are wrapped as tagged data with an explicit instruction/data boundary. A CI test ingests a deck containing injected instructions and asserts the answer stays grounded and the `not_covered` logic still fires.

## Output validation

The LLM returns a schema-constrained `Answer`. The API drops unresolvable citations and strips HTML and links before anything reaches the client.

## Abuse limits

Per-user asks/min and a daily token budget; upload size and type limits; instructor-only upload endpoints.

## Privacy

`notes_opt_out` is applied server-side in step 2 of `/ask` ([flows.md](./flows.md)). Account deletion removes private datasets. Raw files stay in a private bucket. Third-party LLM usage is disclosed on the landing page.
