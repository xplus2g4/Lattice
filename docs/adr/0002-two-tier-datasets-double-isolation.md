# Two-tier datasets with isolation enforced twice

Each course maps to one global Cognee dataset (readable by every enrolled principal) and one private dataset per enrolled user (owner only); a single `/ask` search spans both. Private notes leaking to another user is the one failure this system cannot afford, so isolation is enforced twice rather than trusting a single mechanism: Cognee's backend access control at the vector and graph level, and an API-level check that every cited chunk belongs to a dataset the caller may read. A CI canary test (`test_private_notes_never_leak`) exercises both, and if cross-dataset search turns out not to isolate, `ASK_TWO_CALL_MODE=1` splits the query without changing the `/ask` contract.

## Consequences

- The API-level layer is `IsolationError` in `lattice/engine.py`. It raises instead of dropping the offending result: a filtered answer would hide the fact that something below the API is misbehaving, and this is the property least safe to fail quietly on.
- `ASK_TWO_CALL_MODE` is documented but not implemented. The [first-cut findings](../research/cognee-1.5.4-first-cut-findings.md) show cross-dataset search does isolate, so the fallback has not been needed; it has to be built before it can be switched on.
