// Workspace tabs: which Materials and Notes are open, in which of at most two groups (left
// and right of a split), and which stay loaded. Every rule is a pure function over a plain
// value, so it is testable without React; the value is kept per user and course in
// localStorage, so tabs survive a reload.

import { useCallback, useMemo } from 'react'

import { useStored } from './storage'

/** A string, so one value keys React, storage and drag-and-drop alike. */
export type TabKey = `material:${string}` | `note:${string}`

export type Tab =
  { kind: 'material'; filename: string } | { kind: 'note'; id: string }

export interface TabGroup {
  tabs: Array<TabKey>
  /** Null only while the group has no tabs, which only the sole group ever does. */
  active: TabKey | null
}

export interface TabLayout {
  /** One group, or two side by side once a tab is dragged to the right. */
  groups: Array<TabGroup>
  /** The group a new tab opens in: the one last clicked into. */
  focused: number
  /** The left group's width in percent while split. */
  split: number
  /** Most recently viewed first; what stays loaded is drawn from the front. */
  recent: Array<TabKey>
}

/** Tabs kept loaded besides those on screen and unsaved Notes; the rest are unloaded. */
export const KEEP_LOADED = 3
const MAX_GROUPS = 2
const MIN_SPLIT = 15

export const EMPTY_LAYOUT: TabLayout = {
  groups: [{ tabs: [], active: null }],
  focused: 0,
  split: 50,
  recent: [],
}

export function materialTab(filename: string): TabKey {
  return `material:${filename}`
}

export function noteTab(id: string): TabKey {
  return `note:${id}`
}

export function parseTab(key: TabKey): Tab {
  const at = key.indexOf(':')
  const value = key.slice(at + 1)
  return key.startsWith('material:')
    ? { kind: 'material', filename: value }
    : { kind: 'note', id: value }
}

function isTabKey(value: unknown): value is TabKey {
  return (
    typeof value === 'string' &&
    /^(material|note):./.test(value) &&
    // A filename or id never spans lines; anything that does is not ours.
    !value.includes('\n')
  )
}

function groupOf(layout: TabLayout, key: TabKey): number {
  return layout.groups.findIndex((g) => g.tabs.includes(key))
}

function touch(recent: Array<TabKey>, key: TabKey): Array<TabKey> {
  return [key, ...recent.filter((k) => k !== key)]
}

/** The group without `key`; if it was active, its right neighbour takes over, else its left. */
function without(group: TabGroup, key: TabKey): TabGroup {
  const at = group.tabs.indexOf(key)
  if (at === -1) return group
  const tabs = group.tabs.filter((k) => k !== key)
  const next = at < tabs.length ? tabs[at] : tabs.at(at - 1)
  const active = group.active === key ? (next ?? null) : group.active
  return { tabs, active }
}

/** A split whose group has emptied closes; focus stays with the group it was on. */
function collapse(layout: TabLayout): TabLayout {
  const groups = layout.groups.filter((g) => g.tabs.length > 0)
  if (groups.length === layout.groups.length) return layout
  if (groups.length === 0) return { ...EMPTY_LAYOUT, split: layout.split }
  const focused = groups.indexOf(layout.groups[layout.focused])
  return { ...layout, groups, focused: Math.max(focused, 0) }
}

/** Shows `key`: activates it where it already is, else opens it right of the focused
 * group's active tab. Returns `layout` itself when nothing changes. */
export function openTab(layout: TabLayout, key: TabKey): TabLayout {
  const at = groupOf(layout, key)
  const index = at === -1 ? layout.focused : at
  const group = layout.groups[index]
  if (
    at === layout.focused &&
    group.active === key &&
    layout.recent[0] === key
  ) {
    return layout
  }
  const tabs = [...group.tabs]
  if (at === -1) {
    const after = group.active ? tabs.indexOf(group.active) + 1 : tabs.length
    tabs.splice(after, 0, key)
  }
  const groups = layout.groups.map((g, i) =>
    i === index ? { tabs, active: key } : g,
  )
  return {
    ...layout,
    groups,
    focused: index,
    recent: touch(layout.recent, key),
  }
}

export function closeTab(layout: TabLayout, key: TabKey): TabLayout {
  const at = groupOf(layout, key)
  if (at === -1) return layout
  return collapse({
    ...layout,
    groups: layout.groups.map((g, i) => (i === at ? without(g, key) : g)),
    recent: layout.recent.filter((k) => k !== key),
  })
}

/** Drag and drop: `key` lands at `index` of group `to`, and is shown there. A group index
 * one past the last opens a split, unless that would leave the tab's own group empty. */
export function moveTab(
  layout: TabLayout,
  key: TabKey,
  to: number,
  index: number,
): TabLayout {
  const from = groupOf(layout, key)
  if (from === -1) return layout
  const target = Math.max(Math.min(to, layout.groups.length, MAX_GROUPS - 1), 0)
  const opensSplit = target === layout.groups.length
  if (opensSplit && layout.groups[from].tabs.length === 1) return layout
  const groups = layout.groups.map((g, i) => (i === from ? without(g, key) : g))
  if (opensSplit) groups.push({ tabs: [], active: null })
  const tabs = [...groups[target].tabs]
  tabs.splice(Math.min(Math.max(index, 0), tabs.length), 0, key)
  groups[target] = { tabs, active: key }
  return collapse({
    ...layout,
    groups,
    focused: target,
    recent: touch(layout.recent, key),
  })
}

export function resizeSplit(layout: TabLayout, split: number): TabLayout {
  return {
    ...layout,
    split: Math.min(Math.max(split, MIN_SPLIT), 100 - MIN_SPLIT),
  }
}

/** Closes every tab `exists` rejects: its Material or Note was deleted elsewhere. */
export function retainTabs(
  layout: TabLayout,
  exists: (key: TabKey) => boolean,
): TabLayout {
  return layout.groups
    .flatMap((g) => g.tabs)
    .filter((key) => !exists(key))
    .reduce(closeTab, layout)
}

/** The tabs that stay mounted: each group's visible tab, then the most recently viewed up
 * to KEEP_LOADED in all, then any Note with unsaved edits, which is never unloaded. */
export function loadedTabs(
  layout: TabLayout,
  dirty: ReadonlySet<TabKey> = new Set(),
): Set<TabKey> {
  const keep = new Set<TabKey>()
  for (const g of layout.groups) if (g.active) keep.add(g.active)
  for (const key of layout.recent) {
    if (keep.size >= KEEP_LOADED) break
    keep.add(key)
  }
  for (const key of dirty) keep.add(key)
  return keep
}

/** Anything unreadable becomes the empty layout rather than an error: it is only a view. */
export function parseLayout(raw: string | null): TabLayout {
  if (!raw) return EMPTY_LAYOUT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_LAYOUT
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY_LAYOUT
  const value = parsed as Partial<Record<keyof TabLayout, unknown>>
  const seen = new Set<TabKey>()
  const groups = (Array.isArray(value.groups) ? value.groups : [])
    .slice(0, MAX_GROUPS)
    .map((g: Partial<Record<keyof TabGroup, unknown>> | null): TabGroup => {
      // A key in two groups is kept only in the first, so every tab has one home.
      const tabs: Array<TabKey> = []
      for (const k of Array.isArray(g?.tabs) ? g.tabs : []) {
        if (isTabKey(k) && !seen.has(k)) {
          seen.add(k)
          tabs.push(k)
        }
      }
      const active = tabs.find((k) => k === g?.active) ?? tabs.at(0) ?? null
      return { tabs, active }
    })
  const layout = collapse({
    groups: groups.length ? groups : EMPTY_LAYOUT.groups,
    focused: Math.min(
      Number.isInteger(value.focused) ? (value.focused as number) : 0,
      Math.max(groups.length - 1, 0),
    ),
    split: 50,
    recent: (Array.isArray(value.recent) ? value.recent : [])
      .filter(isTabKey)
      .filter((k) => seen.has(k)),
  })
  return typeof value.split === 'number'
    ? resizeSplit(layout, value.split)
    : layout
}

/** The tab the focused group is showing: the one the URL names. */
export function focusedTab(layout: TabLayout): TabKey | null {
  return layout.groups[layout.focused].active
}

export function isOpen(layout: TabLayout, key: TabKey): boolean {
  return groupOf(layout, key) !== -1
}

/** One user's tabs in one course. `update` reads storage afresh, so two changes made in
 * the same tick both land, and returns the layout it left, for the caller to follow. */
export function useTabLayout(user: string, course: string) {
  const key = `lattice.tabs:${user}:${course}`
  const [raw, setRaw] = useStored(key, '')
  const layout = useMemo(() => parseLayout(raw || null), [raw])
  const update = useCallback(
    (change: (layout: TabLayout) => TabLayout): TabLayout => {
      const current = parseLayout(localStorage.getItem(key))
      const next = change(current)
      if (next !== current) setRaw(JSON.stringify(next))
      return next
    },
    [key, setRaw],
  )
  return [layout, update] as const
}
