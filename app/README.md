ver# Web app

The browser-facing component of the course knowledge store: TanStack Start (React, file-based routing, SSR) with TanStack Query for talking to the API. Architecture and ownership are in [`docs/wiki/components.md`](../docs/wiki/components.md).

The app uses the persistent RPC API by default at `http://localhost:8000`. Copy
`.env.example` to `.env` to change `VITE_API_URL`. Start the API and Postgres using
[`server/README.md`](../server/README.md); real answers need an LLM key and cognified
Materials in the selected course. The shared facade normalizes API records for both
the reader workspace and existing study routes.

For an offline UI preview only, explicitly set `VITE_USE_MOCK_BACKEND=true`. This uses
`src/lib/mock-backend.ts`, produces prewritten example answers, and shows a demo notice
in Ask. Demo and API Session pointers are stored separately. Restart the dev app after
changing `.env`; production builds must be rebuilt to pick up these settings.

The Material reader shows one PDF Page at a time and restores each student's saved
reading position. Text and Markdown Materials have one Page. Each Page has a private
Note editor that autosaves after a short pause, on blur, and on navigation. Saving text
and Cognify have separate status indicators. Failed saves retain a draft in this tab's
session storage; revision conflicts require an explicit choice before replacing saved
text. With demo data, API records still reset on reload; use the real API to verify
persistence across browser sessions.

Reader behavior lives in `components/lattice/material-viewer.tsx` and
`page-note-editor.tsx`; `lib/page-note-draft.ts` owns serialized autosave and draft
recovery independently of their layout. These use the existing Note and reading-position
RPC contracts; no MCP connection is required.

First time on a machine: `scripts/dev-setup.sh` from the repo root sets up both `app/` and `server/`. By hand:

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # .output/ — self-contained Node server (Nitro)
node .output/server/index.mjs
```

Other scripts: `typecheck`, `lint`, `format`, `check` (prettier), `test` (vitest, once) and `test:watch`, `generate-routes` (regenerates `src/routeTree.gen.ts`; also runs on `dev`/`build`), `generate-api` (regenerates `src/lib/generated/` from `../contracts/openapi.json`) and `check-api` (regenerates and fails on a diff, which is what CI runs).

## Layout

| Path                                                   | What it holds                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/index.tsx`                                 | Course picker at `/`.                                                                                                         |
| `src/routes/courses/$course.tsx`                       | Per-course layout: course-code guard, user email, tab bar, `<Outlet/>`.                                                       |
| `src/routes/courses/$course/`                          | One route per section: `materials`, `notes`, `ask.index`, `ask.$sessionId`, and an `index` that renders the reader workspace. |
| `src/routes/__root.tsx`                                | The document shell.                                                                                                           |
| `src/components/materials.tsx`, `notes.tsx`, `ask.tsx` | One section each. Each takes `{ course, user }` and owns its own queries.                                                     |
| `src/components/common.tsx`                            | `ErrorLine`, `StatusBadge`, `pollWhilePending`, shared class strings, the `Scope` prop type.                                  |
| `src/lib/generated/`                                   | Types generated from the contract. Committed, never hand-edited.                                                              |
| `src/lib/api.ts`                                       | The transport: base URL, the `X-User` header, `ApiError`, one function per endpoint.                                          |
| `src/lib/storage.ts`                                   | `useStored`, localStorage as an external store so SSR renders the fallback.                                                   |
| `src/lib/course.ts`                                    | Course-code regex and the recent-courses list.                                                                                |
| `src/router.tsx`                                       | Router construction and the Query/SSR integration.                                                                            |
| `src/integrations/tanstack-query/`                     | `QueryClient` context and devtools panel.                                                                                     |
| `src/test/`                                            | Test harness: MSW handlers, contract-typed fixtures, render helpers. No production code.                                      |
| `src/styles.css`                                       | Tailwind entry.                                                                                                               |

Import from `src/` with the `#/` alias.

Wire types are generated from `contracts/openapi.json` into `src/lib/generated/`
([ADR 0005](../docs/adr/0005-generated-openapi-contract.md)). `api.ts` consumes those RPC
types and projects them into the UI's Material, Note, Session and Citation view models.
Import UI types from `#/lib/api`; regenerate the wire types when the backend changes.
The query-type union is derived from the generated request, not maintained independently.

The course lives in the URL. The standalone study routes keep a conversation in
`$sessionId`, making it linkable and supporting back/forward. The reader workspace also
retains the mock shell's local Session pointer and history picker. `Ask` therefore takes
`sessionId` plus `onSessionStarted` and `onLeaveSession`, and the route decides where
those go; the component never navigates and never touches storage.

What is still stored is the user email (`lattice.user`) and the recent-course list
(`lattice.courses`). Read and write both through `useStored` so the SSR fallback and the
cross-tab `storage` event keep working. The email has its own hook, `useUser`, which is
also how a section route reads it without the layout passing it down.

## Tests

`npm test` runs vitest against jsdom. Tests need neither a running API nor an LLM key: the
API is mocked at the HTTP boundary with MSW, so a `cognifying` material or a 404 session
costs nothing to reproduce. This is also how a section can be built before the endpoint
behind it exists.

Config lives in `vitest.config.ts` rather than a `test` block in `vite.config.ts`, which
loads Nitro, TanStack Start and devtools; a jsdom run needs none of that.

Three rules keep the harness honest:

- **HTTP handlers return generated contract types.** UI fixtures are serialized into the
  RPC shapes in `src/test/handlers.ts`, so a changed wire model fails typecheck rather
  than drifting into a hand-written parallel response shape.
- **Mock only at the HTTP boundary.** Never mock `src/lib/api.ts` or a component; the
  transport, the `X-User` header and the error flattening are behaviour under test.
- **An unmocked request fails the run** (`onUnhandledRequest: 'error'`). Reach for
  `answerNextAskWith` rather than replacing the `/ask` handler, which would skip the
  session bookkeeping and hand the client an id nothing can read back.

Two tests in `materials.test.tsx` wait on real seconds, because the poll interval is a
real two of them. That is the whole budget; keep it there.
