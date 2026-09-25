# Lattice product modules

Product-specific modules that compose the shadcn primitives in `../ui`.

- Home: `course-card` renders a `CourseSummary` from the API.
- Course workspace (`/courses/$courseId`): `materials-panel` (upload + ingest
  status), `notes-panel` (list + PDF upload), `ask-panel` (session turns, history;
  one composed answer with its references, then a bullet-point block per Related
  course whose references open that course's reader in a new tab; it scrolls to the
  bottom only when a question is sent). `status-badge` renders ingest status.
- Tabs: every Material and Note opens as a tab (`tab-group`) between the sidebar and
  Ask. The URL names the tab in front (`?material=` or `?note=`); the rest of the
  layout lives in `#/lib/tabs`. `material-viewer` shows a Material or PDF Note, and
  `note-editor` renders a typed Note as Markdown and edits it on double-click. `editor-area` holds up to two groups:
  drag a tab to reorder it, move it across, or split, and drag the divider to resize.
- All data comes from `#/lib/api` (the real backend); `#/lib/library` holds the
  client-side course list and last-opened material, and `#/lib/user` holds the
  `X-User` identity. Components never read localStorage directly.

Do not duplicate accessible primitive behaviour here; add a Lattice module only
when product behaviour is reused.
