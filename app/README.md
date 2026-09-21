# Web app

The browser-facing component of the course knowledge store: TanStack Start (React, file-based routing, SSR) with TanStack Query for talking to the API. Architecture and ownership are in [`docs/wiki/components.md`](../docs/wiki/components.md).

The app currently runs on its own: every call in `src/lib/api.ts` is served by the in-memory `src/lib/mock-backend.ts`, so `npm run dev` needs no API behind it. Wiring it to the RPC endpoints on `main` is a separate change.

First time on a machine: `scripts/dev-setup.sh` from the repo root sets up both `app/` and `server/`. By hand:

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # .output/ — self-contained Node server (Nitro)
node .output/server/index.mjs
```

Other scripts: `typecheck`, `lint`, `format`, `check` (prettier), `generate-routes` (regenerates `src/routeTree.gen.ts`; also runs on `dev`/`build`).

## Layout

- `src/routes/` — file-based routes; `__root.tsx` is the document shell.
- `src/lib/api.ts` — the call surface the app codes against, with `mock-backend.ts` behind it.
- `src/router.tsx` — router construction and the Query/SSR integration.
- `src/integrations/tanstack-query/` — `QueryClient` context and devtools panel.
- `src/styles.css` — Tailwind entry.

Import from `src/` with the `#/` alias.
