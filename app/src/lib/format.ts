// Small presentation helpers for the home screen: turning a stored filename into a
// readable title, an ISO timestamp into "2 hours ago", and a filename into its type label.

/** Cleans a raw filename into a title: drops the extension and a trailing " (1)" copy
 * suffix, turns underscores and dashes into spaces, and capitalizes each word. */
export function cleanTitle(filename: string): string {
  const withoutExt = filename.replace(/\.[a-z0-9]+$/i, '')
  const withoutCopy = withoutExt.replace(/[\s._-]*\(\d+\)\s*$/, '')
  const spaced = withoutCopy.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced) return withoutExt.trim() || filename
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The uppercase file-type label for a filename, e.g. "kant.pdf" -> "PDF". */
export function fileExtLabel(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toUpperCase() : 'FILE'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** A short relative time like "just now", "5 minutes ago", "3 days ago". Falls back to a
 * date for anything older than a few weeks. Returns null for a missing or unparseable time. */
export function relativeTime(iso: string | undefined | null, now = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = now - then
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  if (diff < WEEK) return plural(Math.floor(diff / DAY), 'day')
  if (diff < 4 * WEEK) return plural(Math.floor(diff / WEEK), 'week')
  return new Date(then).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

// A greeting is a phrase that weaves in the name when there is one. `named` reads like
// "Good morning, Ada"; `asked` keeps the question mark last, "Night owl, Ada?".
type Phrase = (name: string) => string
const named =
  (base: string): Phrase =>
  (name) =>
    name ? `${base}, ${name}` : base
const asked =
  (base: string): Phrase =>
  (name) =>
    name ? `${base}, ${name}?` : `${base}?`

/** The candidate greetings for an hour of the day, most specific band first. */
function greetingSet(hours: number): Array<Phrase> {
  if (hours >= 22 || hours < 5)
    return [asked('Burning the midnight oil'), asked('Night owl'), asked('Still up')]
  if (hours < 8) return [asked('Up early'), named('Rise and shine')]
  if (hours < 12) return [named('Good morning'), named('Morning')]
  if (hours < 17) return [named('Good afternoon'), named('Hope your day’s going well')]
  if (hours < 21) return [named('Good evening'), named('Evening')]
  return [asked('Winding down'), named('Good evening')]
}

/** A time-of-day greeting with a little variety: `seed` (0–1) picks which phrasing, so a
 * caller can keep it stable across re-renders. `name` is woven in when present. */
export function greeting(
  hours = new Date().getHours(),
  name = '',
  seed = Math.random(),
): string {
  const set = greetingSet(hours)
  const index = Math.min(set.length - 1, Math.floor(seed * set.length))
  return set[index](name)
}
