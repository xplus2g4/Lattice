# Web app

The browser-facing component of the course knowledge store: TanStack Start (React, file-based routing, SSR) with TanStack Query for talking to the API. Architecture and ownership are in [`docs/wiki/components.md`](../docs/wiki/components.md).

First time on a machine: `scripts/dev-setup.sh` from the repo root sets up both `app/` and `server/`, including `app/.env` (`VITE_API_URL`, where the API listens). By hand:

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # .output/ — self-contained Node server (Nitro)
node .output/server/index.mjs
```

Other scripts: `typecheck`, `lint`, `format`, `check` (prettier), `generate-routes` (regenerates `src/routeTree.gen.ts`; also runs on `dev`/`build`).

## Layout

| Path                                                   | What it holds                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/routes/index.tsx`                                 | Course picker at `/`.                                                                        |
| `src/routes/courses/$course.tsx`                       | Per-course page; owns the user email and composes the three sections.                        |
| `src/routes/__root.tsx`                                | The document shell.                                                                          |
| `src/components/materials.tsx`, `notes.tsx`, `ask.tsx` | One section each. Each takes `{ course, user }` and owns its own queries.                    |
| `src/components/common.tsx`                            | `ErrorLine`, `StatusBadge`, `pollWhilePending`, shared class strings, the `Scope` prop type. |
| `src/lib/api.ts`                                       | The typed client. The only module that knows the API shape.                                  |
| `src/lib/storage.ts`                                   | `useStored`, localStorage as an external store so SSR renders the fallback.                  |
| `src/lib/course.ts`                                    | Course-code regex and the recent-courses list.                                               |
| `src/router.tsx`                                       | Router construction and the Query/SSR integration.                                           |
| `src/integrations/tanstack-query/`                     | `QueryClient` context and devtools panel.                                                    |
| `src/styles.css`                                       | Tailwind entry.                                                                              |

Import from `src/` with the `#/` alias.

Course scope lives in the URL, not in state: a section gets its course from the route param via the page, never from `localStorage`. What is stored is the user email (`lattice.user`), the recent-course list (`lattice.courses`), and one session id per course and user (`lattice.session.{course}.{user}`). Read and write all of them through `useStored` so the SSR fallback and the cross-tab `storage` event keep working.
