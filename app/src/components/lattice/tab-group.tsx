import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { useCallback, useState } from 'react'

import { MaterialViewer } from '#/components/lattice/material-viewer'
import { readingPosition, saveReadingPosition } from '#/lib/reading-position'
import { parseTab } from '#/lib/tabs'
import { cn } from '#/lib/utils'

import type { PageRange } from '#/components/lattice/material-viewer'
import type { TabGroup, TabKey } from '#/lib/tabs'

/** The tab the URL names and the Page it asks for; only that tab receives the Page. */
export type TabRequest = { tab: TabKey | null } & PageRange

function tabLabel(tab: TabKey): string {
  const parsed = parseTab(tab)
  return parsed.kind === 'material' ? parsed.filename : parsed.id
}

function TabBody({
  user,
  course,
  tab,
  range,
}: {
  user: string
  course: string
  tab: TabKey
  range: PageRange
}) {
  const parsed = parseTab(tab)
  // Read once: a tab that was unloaded returns to where the reader left it.
  const [resume] = useState(() => readingPosition(user, course, tab))
  const onPage = useCallback(
    (page: number) => saveReadingPosition(user, course, tab, page),
    [user, course, tab],
  )
  if (parsed.kind !== 'material') return null
  return (
    <MaterialViewer
      course={course}
      filename={parsed.filename}
      {...range}
      resume={resume}
      onPage={onPage}
    />
  )
}

// Editor tabs, not the pill toggles in `ui/tabs`, so this styles the Radix primitive
// directly; keyboard focus and roles still come from Radix.
export function TabGroupView({
  user,
  course,
  group,
  loaded,
  focused,
  request,
  onSelect,
  onClose,
}: {
  user: string
  course: string
  group: TabGroup
  /** Only these tabs are mounted; the rest are unloaded until shown again. */
  loaded: ReadonlySet<TabKey>
  /** Whether this is the group new tabs open in. */
  focused: boolean
  request: TabRequest
  onSelect: (tab: TabKey) => void
  onClose: (tab: TabKey) => void
}) {
  return (
    <TabsPrimitive.Root
      value={group.active ?? ''}
      onValueChange={(value) => onSelect(value as TabKey)}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <TabsPrimitive.List
        aria-label="Open tabs"
        className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/40"
      >
        {group.tabs.map((tab) => {
          const label = tabLabel(tab)
          const active = tab === group.active
          return (
            <div
              key={tab}
              // Middle-click closes, as in an editor.
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                onClose(tab)
              }}
              className={cn(
                'flex shrink-0 items-center border-t-2 border-r border-r-border',
                !active && 'border-t-transparent',
                active && 'bg-background',
                active && (focused ? 'border-t-primary' : 'border-t-border'),
              )}
            >
              <TabsPrimitive.Trigger
                value={tab}
                title={label}
                aria-keyshortcuts="Delete"
                onKeyDown={(e) => {
                  if (e.key === 'Delete') onClose(tab)
                }}
                className="max-w-56 truncate py-1.5 pl-3 pr-1 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground"
              >
                {label}
              </TabsPrimitive.Trigger>
              <button
                type="button"
                // Out of the Tab order: Delete on the tab closes it from the keyboard.
                tabIndex={-1}
                aria-label={`Close ${label}`}
                onClick={() => onClose(tab)}
                className="mr-1 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
              </button>
            </div>
          )
        })}
      </TabsPrimitive.List>
      <div className="relative min-h-0 flex-1">
        {group.tabs
          .filter((tab) => loaded.has(tab))
          .map((tab) => (
            <TabsPrimitive.Content
              key={tab}
              value={tab}
              forceMount
              // Hidden but still laid out, so a PDF keeps its scroll position and width.
              className="absolute inset-0 data-[state=inactive]:invisible"
            >
              <TabBody
                user={user}
                course={course}
                tab={tab}
                range={
                  tab === request.tab
                    ? {
                        page: request.page,
                        pageEnd: request.pageEnd,
                        jump: request.jump,
                      }
                    : {}
                }
              />
            </TabsPrimitive.Content>
          ))}
      </div>
    </TabsPrimitive.Root>
  )
}
