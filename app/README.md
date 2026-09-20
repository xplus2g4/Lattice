# Web app

The browser-facing component of the course knowledge store: TanStack Start (React, file-based routing, SSR) with TanStack Query for talking to the API. Architecture and ownership are in [`docs/wiki/components.md`](../docs/wiki/components.md).

First time on a machine: `scripts/dev-setup.sh` from the repo root sets up both `app/` and `server/`, including `app/.env` (`VITE_API_URL`, where the API listens). By hand:

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # .output/ — self-contained Node server (Nitro)
node .output/server/index.mjs
```

Other scripts: `typecheck`, `lint`, `format`, `check` (prettier), `test` (vitest, once) and `test:watch`, `generate-routes` (regenerates `src/routeTree.gen.ts`; also runs on `dev`/`build`), `generate-api` (regenerates `src/lib/generated/` from `../contracts/openapi.json`) and `check-api` (regenerates and fails on a diff, which is what CI runs).

## Layout

| Path                                                   | What it holds                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/routes/index.tsx`                                 | Course picker at `/`.                                                                        |
| `src/routes/courses/$course.tsx`                       | Per-course page; owns the user email and composes the three sections.                        |
| `src/routes/__root.tsx`                                | The document shell.                                                                          |
| `src/components/materials.tsx`, `notes.tsx`, `ask.tsx` | One section each. Each takes `{ course, user }` and owns its own queries.                    |
| `src/components/common.tsx`                            | `ErrorLine`, `StatusBadge`, `pollWhilePending`, shared class strings, the `Scope` prop type. |
| `src/lib/generated/`                                   | Types generated from the contract. Committed, never hand-edited.                             |
| `src/lib/api.ts`                                       | The transport: base URL, the `X-User` header, `ApiError`, one function per endpoint.         |
| `src/lib/storage.ts`                                   | `useStored`, localStorage as an external store so SSR renders the fallback.                  |
| `src/lib/course.ts`                                    | Course-code regex and the recent-courses list.                                               |
| `src/router.tsx`                                       | Router construction and the Query/SSR integration.                                           |
| `src/integrations/tanstack-query/`                     | `QueryClient` context and devtools panel.                                                    |
| `src/test/`                                            | Test harness: MSW handlers, contract-typed fixtures, render helpers. No production code.     |
| `src/styles.css`                                       | Tailwind entry.                                                                              |

Import from `src/` with the `#/` alias.

Never declare an API shape by hand. `Material`, `Note`, `Turn` and the rest are generated
from `contracts/openapi.json` into `src/lib/generated/` and re-exported by `src/lib/api.ts`,
so import them from `#/lib/api` as before and regenerate when the API changes
([ADR 0005](../docs/adr/0005-generated-openapi-contract.md)). `api.ts` owns the transport
only. Unions that FastAPI inlines rather than names, `IngestStatus` and `QueryType`, are
derived there from the generated types rather than retyped.

Course scope lives in the URL, not in state: a section gets its course from the route param via the page, never from `localStorage`. What is stored is the user email (`lattice.user`), the recent-course list (`lattice.courses`), and one session id per course and user (`lattice.session.{course}.{user}`). Read and write all of them through `useStored` so the SSR fallback and the cross-tab `storage` event keep working.

## Tests

`npm test` runs vitest against jsdom. Tests need neither a running API nor an LLM key: the
API is mocked at the HTTP boundary with MSW, so a `cognifying` material or a 404 session
costs nothing to reproduce. This is also how a section can be built before the endpoint
behind it exists.

Config lives in `vitest.config.ts` rather than a `test` block in `vite.config.ts`, which
loads Nitro, TanStack Start and devtools; a jsdom run needs none of that.

Three rules keep the harness honest:

- **Fixtures are typed as the generated contract types.** A response model that changes on
  the server regenerates `src/lib/generated/` and fails `npm run typecheck` in
  `src/test/fixtures.ts`, so the mocks cannot drift into a hand-written parallel shape.
- **Mock only at the HTTP boundary.** Never mock `src/lib/api.ts` or a component; the
  transport, the `X-User` header and the error flattening are behaviour under test.
- **An unmocked request fails the run** (`onUnhandledRequest: 'error'`). Reach for
  `answerNextAskWith` rather than replacing the `/ask` handler, which would skip the
  session bookkeeping and hand the client an id nothing can read back.

Two tests in `materials.test.tsx` wait on real seconds, because the poll interval is a
real two of them. That is the whole budget; keep it there.
