import { describe, expect, it } from 'vitest'

import {
  EMPTY_LAYOUT,
  KEEP_LOADED,
  closeTab,
  loadedTabs,
  materialTab,
  moveTab,
  noteTab,
  openTab,
  parseLayout,
  parseTab,
  resizeSplit,
  retainTabs,
} from '#/lib/tabs'

import type { TabKey, TabLayout } from '#/lib/tabs'

const a = materialTab('week1.pdf')
const b = materialTab('week2.pdf')
const c = materialTab('memo.md')
const n = noteTab('3f1c')

function opened(...keys: Array<TabKey>): TabLayout {
  return keys.reduce(openTab, EMPTY_LAYOUT)
}

/** Each group's tabs, with the active one marked `*`: the shape a reader sees. */
function bars(layout: TabLayout): Array<Array<string>> {
  return layout.groups.map((g) =>
    g.tabs.map((k) => (k === g.active ? `*${k}` : k)),
  )
}

describe('opening a tab', () => {
  it('shows an already open tab instead of opening it twice', () => {
    const layout = openTab(opened(a, b), a)

    expect(bars(layout)).toEqual([[`*${a}`, b]])
  })

  it('opens a new tab right of the active one', () => {
    const layout = openTab(openTab(opened(a, b), a), c)

    expect(bars(layout)).toEqual([[a, `*${c}`, b]])
  })

  it('changes nothing when the tab is already in front', () => {
    const layout = opened(a, b)

    expect(openTab(layout, b)).toBe(layout)
  })

  it('focuses the other group when the tab is already there', () => {
    const split = moveTab(opened(a, b), b, 1, 0)
    const back = openTab(split, a)

    expect(back.focused).toBe(0)
    expect(openTab(back, b).focused).toBe(1)
  })

  it('opens in the group last clicked into', () => {
    const split = openTab(moveTab(opened(a, b), b, 1, 0), c)

    expect(bars(split)).toEqual([[`*${a}`], [b, `*${c}`]])
  })
})

describe('closing a tab', () => {
  it('shows the right neighbour of a closed active tab', () => {
    const layout = closeTab(openTab(opened(a, b, c), b), b)

    expect(bars(layout)).toEqual([[a, `*${c}`]])
  })

  it('shows the left neighbour when the closed tab was last', () => {
    const layout = closeTab(opened(a, b), b)

    expect(bars(layout)).toEqual([[`*${a}`]])
  })

  it('leaves one empty group once every tab is closed', () => {
    expect(closeTab(opened(a), a)).toEqual(EMPTY_LAYOUT)
  })

  it('closes the split when a group loses its last tab', () => {
    const split = moveTab(opened(a, b), b, 1, 0)
    const layout = closeTab(split, b)

    expect(bars(layout)).toEqual([[`*${a}`]])
    expect(layout.focused).toBe(0)
  })
})

describe('dragging a tab', () => {
  it('reorders it within its group', () => {
    const layout = moveTab(opened(a, b, c), c, 0, 0)

    expect(bars(layout)).toEqual([[`*${c}`, a, b]])
  })

  it('opens a split when dropped right of the only group', () => {
    const layout = moveTab(opened(a, b), a, 1, 0)

    expect(bars(layout)).toEqual([[`*${b}`], [`*${a}`]])
    expect(layout.focused).toBe(1)
  })

  it('does not split off a group’s only tab', () => {
    const layout = opened(a)

    expect(moveTab(layout, a, 1, 0)).toBe(layout)
  })

  it('never makes a third group', () => {
    const split = moveTab(opened(a, b, c), c, 1, 0)

    expect(bars(moveTab(split, a, 2, 5))).toEqual([[`*${b}`], [c, `*${a}`]])
  })

  it('closes the split when a group’s last tab moves out', () => {
    const split = moveTab(opened(a, b), b, 1, 0)
    const layout = moveTab(split, b, 0, 0)

    expect(bars(layout)).toEqual([[`*${b}`, a]])
    expect(layout.focused).toBe(0)
  })
})

describe('what stays loaded', () => {
  it(`keeps only the ${KEEP_LOADED} most recently viewed tabs`, () => {
    const layout = opened(a, b, c, n)

    expect(loadedTabs(layout)).toEqual(new Set([n, c, b]))
  })

  it('always keeps each group’s visible tab', () => {
    // `a` was last viewed longest ago, but it is on screen in the left group.
    const split = openTab(openTab(moveTab(opened(a, b), b, 1, 0), c), n)

    expect(loadedTabs(split)).toEqual(new Set([a, n, c]))
  })

  it('never unloads a Note with unsaved edits', () => {
    const layout = openTab(opened(n, a, b), c)

    expect(loadedTabs(layout, new Set([n]))).toEqual(new Set([c, b, a, n]))
  })
})

describe('a stored layout', () => {
  it('round-trips through JSON', () => {
    const layout = resizeSplit(moveTab(opened(a, b, n), b, 1, 0), 30)

    expect(parseLayout(JSON.stringify(layout))).toEqual(layout)
  })

  it('reads anything unreadable as no tabs', () => {
    for (const raw of [null, '', 'not json', 'null', '42', '{"groups":"x"}']) {
      expect(parseLayout(raw)).toEqual(EMPTY_LAYOUT)
    }
  })

  it('keeps a tab listed twice only in its first group', () => {
    const raw = JSON.stringify({
      groups: [
        { tabs: [a, 'bogus', b], active: b },
        { tabs: [b], active: b },
      ],
      focused: 1,
      recent: [b, 'material:gone.pdf'],
      split: 99,
    })

    expect(parseLayout(raw)).toEqual({
      groups: [{ tabs: [a, b], active: b }],
      focused: 0,
      split: 85,
      recent: [b],
    })
  })
})

it('closes the tabs of deleted Materials and Notes', () => {
  const layout = retainTabs(opened(a, b, n), (k) => k !== b)

  expect(bars(layout)).toEqual([[a, `*${n}`]])
})

it('reads a tab back from its key, even when the name has a colon', () => {
  expect(parseTab(materialTab('a:b.pdf'))).toEqual({
    kind: 'material',
    filename: 'a:b.pdf',
  })
  expect(parseTab(n)).toEqual({ kind: 'note', id: '3f1c' })
})
