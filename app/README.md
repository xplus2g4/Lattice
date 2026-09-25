# Web app

The browser-facing component of the course knowledge store: TanStack Start (React, file-based routing, SSR) with TanStack Query for talking to the API. Architecture and ownership are in [`docs/wiki/components.md`](../docs/wiki/components.md).

The app talks to the persistent RPC API at `VITE_API_URL`, so it needs the server running. The shared facade in `src/lib/api.ts` normalizes server records for both the reader workspace and existing study routes.

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
| `src/routes/_authed.tsx`                               | The gate: redirects to `/login` without a session. Every app route lives under it.                                            |
| `src/routes/_authed/index.tsx`                         | Course picker at `/`, plus the invite-minting panel for instructors.                                                          |
| `src/routes/_authed/courses/$course.tsx`               | Per-course layout: course-code guard, tab bar, `<Outlet/>`.                                                                   |
| `src/routes/_authed/courses/$course/`                  | The reader workspace `index` (Materials, Notes, Ask sections).                                                                |
| `src/routes/login.tsx`, `invite/$token.tsx`            | Public pages: Google sign-in, and the invite landing that stashes the token before OAuth.                                     |
| `src/routes/auth/`                                     | Server routes for the OAuth round trip: `google` (start), `google/callback`, `logout`.                                        |
| `src/routes/__root.tsx`                                | The document shell.                                                                                                           |
| `src/components/materials.tsx`, `notes.tsx`, `ask.tsx` | One section each. Each takes `{ course, user }` and owns its own queries.                                                     |
| `src/components/common.tsx`                            | `ErrorLine`, `StatusBadge`, `pollWhilePending`, shared class strings, the `Scope` prop type.                                  |
| `src/lib/auth.ts`, `auth.server.ts`                    | Session server functions (`getSessionUser`, `getApiToken`, `redeemInvite`) and the server-only OAuth/session/token machinery. |
| `src/lib/generated/`                                   | Types generated from the contract. Committed, never hand-edited.                                                              |
| `src/lib/api.ts`                                       | The transport: base URL, the `Bearer` header, `ApiError`, one function per endpoint.                                          |
| `src/lib/storage.ts`                                   | `useStored`, localStorage as an external store so SSR renders the fallback.                                                   |
| `src/lib/user.ts`                                      | `useUser`: the session email via `getSessionUser`, replacing the old `lattice.user` key.                                      |
| `src/lib/course.ts`                                    | Course-code regex and the recent-courses list.                                                                                |
| `src/router.tsx`                                       | Router construction and the Query/SSR integration.                                                                            |
| `src/integrations/tanstack-query/`                     | `QueryClient` context and devtools panel.                                                                                     |
| `src/test/`                                            | Test harness: MSW handlers, contract-typed fixtures, render helpers. No production code.                                      |
| `src/styles.css`                                       | Tailwind entry.                                                                                                               |

Import from `src/` with the `#/` alias.

## Landing page preview

Open `http://localhost:3000/` signed out after `npm run dev`. `_authed.tsx`
redirects a signed-out visitor from `/` to `/landing` (a public route in
`src/routes/landing.tsx`) and shows the course picker at `/` when there is a
session; every other signed-in route still redirects a signed-out visitor
to `/login`. It needs no API. `src/components/landing/landing-page.tsx` holds
the copy and uses the same Tailwind tokens, `fieldnotes-*` classes and
`LogoMark` as `/login`, so the two pages share one brand. Its copy describes
only shipped features; Sign up and Sign in both go to `/login`, where the
Invite code form and Google sign-in live.

`landingHead` supplies metadata for TanStack Devtools' SEO social previews.
Set `VITE_SITE_URL` to the public frontend origin before a production build;
it defaults to `http://localhost:3000`. Canonical and social image URLs use that
origin. Public social crawlers need a deployed, reachable URL. The social image
is `public/landing-assets/social-preview.png`. The standalone static site in
`marketing/` is built separately and is not updated by changes here.

Wire types are generated from `contracts/openapi.json` into `src/lib/generated/`
([ADR 0005](../docs/adr/0005-generated-openapi-contract.md)). `api.ts` consumes those RPC
types and projects them into the UI's Material, Note, Session and Citation view models.
Import UI types from `#/lib/api`; regenerate the wire types when the backend changes.
The query-type union is derived from the generated request, not maintained independently.

The course lives in the URL. The standalone study routes keep a conversation in
`$sessionId`, making it linkable and supporting back/forward. The reader workspace also
retains a local Session pointer and history picker. `Ask` therefore takes
`sessionId` plus `onSessionStarted` and `onLeaveSession`, and the route decides where
those go; the component never navigates and never touches storage.

Identity is server-owned now: `useUser()` reads the session email through the
`getSessionUser` server function, so there is no `lattice.user` key and nothing for a
route to write. The recent-course list (`lattice.courses`) stays in localStorage through
`useStored` so the SSR fallback and the cross-tab `storage` event keep working.

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
  transport, the `Bearer` header and the error flattening are behaviour under test.
  (`#/lib/auth` itself is stubbed in `src/test/setup.ts` so tests run as a fixed user.)
- **An unmocked request fails the run** (`onUnhandledRequest: 'error'`). Reach for
  `answerNextAskWith` rather than replacing the `/ask` handler, which would skip the
  session bookkeeping and hand the client an id nothing can read back.

Two tests in `materials.test.tsx` wait on real seconds, because the poll interval is a
real two of them. That is the whole budget; keep it there.
