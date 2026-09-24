import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { useCallback, useState } from 'react'

import { MaterialViewer } from '#/components/lattice/material-viewer'
import { NoteTab } from '#/components/lattice/note-editor'
import { readingPosition, saveReadingPosition } from '#/lib/reading-position'
import { parseTab } from '#/lib/tabs'
import { cn } from '#/lib/utils'

import type { PageRange } from '#/components/lattice/material-viewer'
import type { NoteTabEvents } from '#/components/lattice/note-editor'
import type { TabGroup, TabKey } from '#/lib/tabs'

/** The tab the URL names and the Page it asks for; only that tab receives the Page. */
export type TabRequest = { tab: TabKey | null } & PageRange

function TabBody({
  user,
  course,
  tab,
  range,
  ...events
}: {
  user: string
  course: string
  tab: TabKey
  range: PageRange
} & NoteTabEvents) {
  const parsed = parseTab(tab)
  // Read once: a tab that was unloaded returns to where the reader left it.
  const [resume] = useState(() => readingPosition(user, course, tab))
  const onPage = useCallback(
    (page: number) => saveReadingPosition(user, course, tab, page),
    [user, course, tab],
  )
  if (parsed.kind === 'note') {
    return (
      <NoteTab
        user={user}
        course={course}
        id={parsed.id}
        {...range}
        resume={resume}
        onPage={onPage}
        {...events}
      />
    )
  }
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

/** One tab in the bar: select, close, drag with the pointer, or move from the keyboard. */
function SortableTab({
  tab,
  name,
  active,
  focused,
  dirty,
  onClose,
  onNudge,
}: {
  tab: TabKey
  name: string
  active: boolean
  focused: boolean
  dirty: boolean
  onClose: (tab: TabKey) => void
  onNudge: (tab: TabKey, step: -1 | 1) => void
}) {
  // Only the pointer listeners: the sortable ARIA attributes would replace Radix's tab role.
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: tab })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // Middle-click closes, as in an editor.
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onClose(tab)
      }}
      className={cn(
        'flex shrink-0 items-center border-t-2 border-r border-r-border',
        !active && 'border-t-transparent',
        active && 'bg-card',
        active && (focused ? 'border-t-primary' : 'border-t-border'),
        isDragging && 'opacity-50',
      )}
    >
      <TabsPrimitive.Trigger
        value={tab}
        title={name}
        aria-keyshortcuts="Delete Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
        onKeyDown={(e) => {
          if (e.key === 'Delete') onClose(tab)
          // The keyboard's drag; Radix leaves modified arrows alone.
          const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
          if (e.altKey && e.shiftKey && arrow) {
            e.preventDefault()
            onNudge(tab, e.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
        className="min-h-11 max-w-56 truncate py-2 pl-4 pr-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:font-medium data-[state=active]:text-foreground"
      >
        {dirty && (
          <span aria-label="unsaved" className="mr-1">
            ●
          </span>
        )}
        {name}
      </TabsPrimitive.Trigger>
      <button
        type="button"
        // Out of the Tab order: Delete on the tab closes it from the keyboard.
        tabIndex={-1}
        aria-label={`Close ${name}`}
        onClick={() => onClose(tab)}
        className="mr-1 flex size-8 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:size-11"
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
      </button>
    </div>
  )
}

// Editor tabs, not the pill toggles in `ui/tabs`, so this styles the Radix primitive
// directly; keyboard focus and roles still come from Radix.
export function TabGroupView({
  index,
  user,
  course,
  group,
  loaded,
  focused,
  request,
  label,
  dirty,
  onSelect,
  onClose,
  onNudge,
  ...events
}: {
  /** The group's place, left (0) or right (1), which names its drop targets. */
  index: number
  user: string
  course: string
  group: TabGroup
  /** Only these tabs are mounted; the rest are unloaded until shown again. */
  loaded: ReadonlySet<TabKey>
  /** Whether this is the group new tabs open in. */
  focused: boolean
  request: TabRequest
  label: (tab: TabKey) => string
  /** Note tabs with unsaved edits, marked ● in the bar. */
  dirty: ReadonlySet<TabKey>
  onSelect: (tab: TabKey) => void
  onClose: (tab: TabKey) => void
  onNudge: (tab: TabKey, step: -1 | 1) => void
} & NoteTabEvents) {
  // The bar's empty end takes a dropped tab at the end.
  const { setNodeRef: setBarRef } = useDroppable({ id: `bar:${index}` })
  return (
    <TabsPrimitive.Root
      value={group.active ?? ''}
      onValueChange={(value) => onSelect(value as TabKey)}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <TabsPrimitive.List
        ref={setBarRef}
        aria-label="Open tabs"
        className="flex min-h-12 shrink-0 overflow-x-auto border-b border-border bg-sidebar"
      >
        <SortableContext
          id={`group:${index}`}
          items={group.tabs}
          strategy={horizontalListSortingStrategy}
        >
          {group.tabs.map((tab) => (
            <SortableTab
              key={tab}
              tab={tab}
              name={label(tab)}
              active={tab === group.active}
              focused={focused}
              dirty={dirty.has(tab)}
              onClose={onClose}
              onNudge={onNudge}
            />
          ))}
        </SortableContext>
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
                {...events}
              />
            </TabsPrimitive.Content>
          ))}
      </div>
    </TabsPrimitive.Root>
  )
}
