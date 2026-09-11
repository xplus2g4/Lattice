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

- `src/routes/` — file-based routes; `__root.tsx` is the document shell.
- `src/router.tsx` — router construction and the Query/SSR integration.
- `src/integrations/tanstack-query/` — `QueryClient` context and devtools panel.
- `src/styles.css` — Tailwind entry.

Import from `src/` with the `#/` alias.
