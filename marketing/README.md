# Lattice marketing site

A standalone, statically rendered marketing page for GitHub Pages, within the existing Lattice repository. It has three content sections: hero, features, and pricing. Its HTML contains the complete copy and metadata before JavaScript runs. The small browser script only adds preview interactions; no application API or authentication service is called.

## Product decisions confirmed on 23 September 2026

The owner explicitly chose to **retain concept-map generation, prerequisites and mastery states, and personal revision guidance as the three marketing features**. The updated assignment's reader/notes/quizzes MVP and the repository's current Phase 1 scope differ from this vision. This is an intentional marketing decision, not a change to the application roadmap or a claim that concept graphs already work. Product illustrations are labelled as illustrative/product vision; benefits and prices are proposed. There are no fabricated testimonials, endorsements, usage figures, learning outcomes, or competitor comparisons.

- Audience: primarily NUS students; this does not claim NUS endorsement or a live institutional partnership.
- A course coordinator must onboard a course with the Lattice team before students can access that course or upload its Materials. Coordinators actively approve generated course structures.
- Unsupported courses can be prioritised through student petitions in the proposed product. The marketing page explains this but does not accept or count votes.
- Materials and textbooks listed by coordinators ground guidance. If Materials do not cover a question, the proposed product draws on those approved textbooks, with citations available. This page does not implement retrieval or fabricate real lecture citations.
- Optional quizzes update mastery. Prerequisite exercises help students work through gaps; the marketing page does not gate course access on taking quizzes.
- Lecturers receive aggregate results only. This is intended product behaviour; the marketing site does not implement or audit application permissions.
- Retain the pricing from the assignment: Free at S$0 with 3 AI study-plan updates per month; Plus at S$6.90/month or S$24 for four months with 20 updates per month; Campus includes Plus within one sponsored course and standard onboarding. The Campus price text is exactly **“contact us for course pricings”**. Advanced integrations and extensive onboarding are quoted separately.
- The supplied Figma PDFs are the design reference: Figtree, teal `#00D5BE`, deep green `#032823`, light surfaces, and the supplied blue three-node logo. The original logo/wordmark images were extracted from Components.pdf without redesign. The marketing page uses a light academic layout and restrained transitions, with reduced-motion support.

## Placeholder interactions — intentionally no submissions

These decisions were explicitly requested by the owner:

| Interaction                       | Behaviour                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join the waitlist                 | Informational dialog: registration is not open, nothing was recorded. No form, fields, list, confirmation of success, or submission.                                                                                                |
| Campus contact                    | Informational dialog describing the proposed Campus offer. No email or contact enquiry is sent.                                                                                                                                     |
| Course petitions                  | Informational text only. No voting, course submission, or fabricated petition totals.                                                                                                                                               |
| Google, Microsoft, GitHub sign-in | Open **Sign-in preview** in the footer. A demo-only notice appears before the provider buttons. Clicking a provider displays another informational notice; there is no OAuth redirect, token, account creation, or data collection. |
| Concept map                       | Selecting a sample concept changes its explanatory text locally. Sample mastery states are fixed illustrative data, not assessment results.                                                                                         |
| Telegram                          | A genuine share-composer link for the canonical website URL. The visitor decides whether to send it.                                                                                                                                |
| Copy link                         | Copies the canonical production address; when clipboard access is unavailable, displays the address for manual copying.                                                                                                             |
| Instagram Story                   | Downloads a 1080×1920 PNG and explains how to add it to a Story with a link sticker. Does not publish, log in, or imply direct website-to-Story posting.                                                                            |

No analytics, advertising scripts, cookies, local storage, external fonts, or visitor-data forms are added. No invented privacy-policy/terms links are included. Standard hosting-provider request logging is outside the scope of this page.

## Why a separate static site

The existing `app/` uses TanStack Start, React 19, Tailwind, and a server build with an RPC API. Its Materials/Notes/Ask workspace requires the API. GitHub Pages serves static files, so `marketing/` is independently built and deployable; it does not replace the application's course picker, modify its routing, or alter the server.

Visual tokens, Figtree typography, rounded controls, and status colours follow the app and supplied design system. The marketing site does not import API-dependent application components or run a second React application for static copy. Native buttons and a modal dialog provide accessible interactions with a small JavaScript payload.

## Build and preview

Requires Node.js 22 or newer (CI uses Node 24). From this folder:

```sh
npm ci
npm run build
npm run check
npm run preview
```

Open `http://127.0.0.1:4173/Lattice/`. `PORT` changes the preview port.

The build writes `dist/`. It copies the original brand images and self-hosted Figtree fonts, renders social cards as PNGs, and creates canonical URLs, Open Graph/X metadata, WebSite structured data, `robots.txt`, `sitemap.xml`, `.nojekyll`, and a 404 page. Each dependency is build-time only; the deployed site makes no third-party requests until a visitor chooses an external share link.

The default canonical address is `https://xplus2g4.github.io/Lattice/`. Set `SITE_URL` to an HTTPS URL before building if the published address changes. For example, in PowerShell:

```powershell
$env:SITE_URL = 'https://example.org/'
npm run build
```

Use the same `SITE_URL` when previewing a changed deployment prefix. Images and font paths are relative, so project-path hosting works without SPA routing fallbacks. `dist/index.html` can also be opened locally for an offline design review; the copy-link and social URLs intentionally still point to the configured production address.

## GitHub Pages

`.github/workflows/marketing-pages.yml` builds and checks on relevant pull requests and pushes. Only a `main` push or a manual run on `main` deploys. Set repository **Settings → Pages → Build and deployment → Source → GitHub Actions** before the first deployment. The deploy job requests only `pages: write` and `id-token: write`; the build has read-only repository access.

Set repository variable `MARKETING_SITE_URL` only when using a different public address, and configure any custom domain separately in GitHub Pages. Keep `SITE_URL`, the Pages domain, and the actual deployment path consistent. The workflow publishes only `marketing/dist`, not the application's server output.

This implementation was prepared locally. A public deployment still needs a valid authenticated GitHub session and access to push changes/configure Pages. A generated canonical URL is not evidence that the site is already live.

## Social previews

- Open Graph / Telegram: `assets/social-preview.png`, 1200×630.
- Instagram Stories: `assets/instagram-story.png`, 1080×1920.
- Both images are generated during every build by `scripts/build.mjs`, using the supplied logo and Figtree text converted to outlines for consistent rendering on Windows and Linux. No image-generation service or runtime endpoint is required.
- Open Graph tags and absolute image URLs are in the initial HTML. Instagram Story sharing uses the downloadable image; Open Graph does not itself post a Story.
- Live previews can only be verified after publication and may be cached by social platforms. On future image changes, version the image URL if refreshing a cached preview is necessary.
- GitHub project sites host `robots.txt` below the project path. Crawlers look for robots policy at the domain root; this file is provided but cannot control the entire `xplus2g4.github.io` origin. The sitemap can be submitted directly after deployment.

## Verification

`npm run check` validates resolved canonical/OG URLs, project-prefix-safe local assets, heading and anchor presence, JSON-LD, sitemap/robots consistency, font files, JavaScript syntax, and both image dimensions. Browser QA should cover desktop/mobile overflow, keyboard activation, modal focus/Escape behaviour, provider notices, all concept selections, clipboard fallback, and the Story download. Live OAuth, backend learning flows, and submission success are deliberately outside this site's scope.

Figtree's OFL licence is distributed with the built fonts. Original brand assets are supplied by the project owner.

## Local verification record — 23 September 2026

- Production build and static checks passed for the default `/Lattice/` address and an alternate deployment prefix; the delivered build is restored to the default address.
- Responsive geometry checked at 320, 390, 600, 768, 820, 1024, and 1440 pixels. A 320-pixel overflow in the Material illustration was fixed and retested.
- Browser checks passed for concept selection, informational waitlist/Campus dialogs, all three provider notices, Escape and focus restoration, Story instructions, and copying the canonical address. No JavaScript errors were reported on the marketing page.
- Axe WCAG 2 A/AA and WCAG 2.1 A/AA scan: 25 passing rules, zero violations after fonts and entrance animations settle. Manual-review items were decorative glyphs and text over the pale Material gradient; ordinary text contrast was also checked from computed styles. This is a scoped check, not an accessibility certification.
- OG and Story PNGs were visually inspected and their 1200×630 / 1080×1920 dimensions checked automatically.
- The existing app frontend was opened for visual reference. Full backend/LLM flows were not exercised or changed; the marketing build has no backend dependency.
- GitHub publication was not performed: the saved GitHub CLI login was invalid. Live social-crawler previews remain unverified until the site is published.
