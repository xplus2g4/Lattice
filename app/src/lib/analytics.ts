// GA4 page views, and nothing else: no user id, no custom events, no consent banner yet.
// A page view carries the route id (`/courses/$course/`), never the resolved path, so no
// course or Material uuid leaves the browser. Loaded at runtime from `router.tsx` when
// `VITE_GA_MEASUREMENT_ID` is set; with it unset no gtag script tag exists.

type Gtag = (...args: Array<unknown>) => void

declare global {
  interface Window {
    dataLayer?: Array<unknown>
    gtag?: Gtag
  }
}

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js'

/** Route ids never reported: the dev sandbox and the design foundation page. */
const IGNORED_PREFIXES = ['/dev', '/foundation']

/** Load gtag.js once and configure it without its automatic page view; `trackPageView`
 * sends those. A no-op during SSR and on repeat calls. */
export function initAnalytics(measurementId: string): void {
  if (typeof window === 'undefined' || window.gtag) return

  window.dataLayer = window.dataLayer ?? []
  // gtag.js reads its commands as `arguments` objects, not arrays, so no arrow function.
  window.gtag = function gtag() {
    window.dataLayer?.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', measurementId, { send_page_view: false })

  const script = document.createElement('script')
  script.async = true
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`
  document.head.appendChild(script)
}

/** Report a page view for a route id. `page_location` is set from the route id, not left
 * out: gtag fills an omitted one from `location.href` (as `dl`), which holds the course
 * id, Material name and page. `page_path` is the plain `dp` the reports group by. */
export function trackPageView(routeId: string): void {
  if (IGNORED_PREFIXES.some((prefix) => routeId.startsWith(prefix))) return
  window.gtag?.('event', 'page_view', {
    page_path: routeId,
    page_location: `${window.location.origin}${routeId}`,
  })
}
