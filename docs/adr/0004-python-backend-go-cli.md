# Python backend for Stage 1, Go at the edges

The Stage 1 backend is Python: Cognee is a Python library and the hot query path (`/ask` to `cognee.search`) calls it in-process. Putting Go in front would force Cognee out-of-process behind its REST server and rebuild tenant isolation across a second auth system, the one property this system cannot get wrong, for performance that single-VM scale does not need. Go still gets two places: the admin CLI now (there is deliberately no super-user path in the API; the CLI talks HTTP with an explicit principal, zero blast radius on the request path), and conditionally the Stage 2 backend rewrite if the spike and eval results trigger the swap away from Cognee, which removes the Python dependency.

## Consequences

- The `/ask` and ingest contracts must be frozen as an OpenAPI spec in-repo before Stage 2 work starts, so a rewrite is mechanical. The spec does not exist yet.
- Canary and eval tests target the contract, not the implementation.
