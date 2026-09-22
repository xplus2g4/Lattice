# Lattice product modules

Product-specific modules that compose the shadcn primitives in `../ui`.

- Home: `course-card` renders a `CourseSummary` from the API.
- `app-shell` owns the persistent Homepage, Materials, Notes, Ask, and Practice
  navigation, including course selection. Product routes reuse the panels below;
  there are no separate legacy Materials, Notes, or Ask implementations.
- Course workspace (`/courses/$courseId`): `materials-panel` (upload + ingest
  status), `notes-panel` (list + editor dialog), `ask-panel` (session turns,
  citations, history). `status-badge` renders ingest status.
- All data comes from `#/lib/api` (the real backend); `#/lib/library` holds the
  client-side course list and last-opened material, and `#/lib/user` holds the
  `X-User` identity. Components never read localStorage directly.

Do not duplicate accessible primitive behaviour here; add a Lattice module only
when product behaviour is reused.
