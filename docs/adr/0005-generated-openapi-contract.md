# The OpenAPI contract is generated, and the web client's types are generated from it

`contracts/openapi.json` is exported from the API's response models rather than hand-written, and the web app's types in `app/src/lib/generated/` are generated from that file; CI regenerates both and fails on a diff. This discharges the consequence recorded in [ADR 0004](./0004-python-backend-go-cli.md) — the contract a Stage 2 rewrite must honour now exists as an artifact instead of a promise — and it removes the hand-transcribed copy of every response model that `app/src/lib/api.ts` used to carry, where a Pydantic change and its TypeScript mirror could drift apart silently until runtime.

## Considered Options

Generating a full client (orval, `@hey-api`'s SDK plugin) was rejected: only the types are generated, and the transport in `api.ts` stays hand-written. That file carries the `X-User` dev-identity header that OAuth will replace and the flattening of FastAPI's `detail` arrays into an `ApiError` — both are decisions worth reading, and a generated SDK would bury the seam that authentication has to change.

Hand-writing the spec was rejected for the reason the whole ADR exists: it would be a second artifact to keep in sync.

## Consequences

- Response models are declared with every always-populated field required, and constructed explicitly, because a Pydantic field with a default is emitted as optional and would generate an optional TypeScript property for a value the API always sends.
- Changing a response model without re-exporting fails CI, as does changing the spec without regenerating the client. The spec will churn as OAuth and Postgres land; that churn is the mechanism working, and costs a regenerate and a commit.
- `openapi-typescript`, the more obvious generator, peers on TypeScript 5 and the web app is on 6. `@hey-api/openapi-ts` supports both.
