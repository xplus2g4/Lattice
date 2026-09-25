import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useState, useSyncExternalStore } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { cn } from '#/lib/utils'

import type { CollisionDetection } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { TabGroup, TabKey, TabLayout } from '#/lib/tabs'

const WIDE = '(min-width: 1024px)'

/** Side by side on a wide screen, stacked on a narrow one. */
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  )
}

// Drop targets, most specific first: a tab (insert there), a tab bar (append), then a
// group's body (move into that group) or the half of a lone group that opens a split.
function rank(id: string) {
  if (id.startsWith('bar:')) return 1
  if (id.startsWith('pane:') || id === 'split') return 2
  return 0
}
const collide: CollisionDetection = (args) =>
  pointerWithin(args)
    .sort((a, b) => rank(String(a.id)) - rank(String(b.id)))
    .slice(0, 1)

/** One group's slot: its tabs, plus the drop zone laid over its body while dragging. */
function GroupSlot({
  index,
  zone,
  wide,
  onFocus,
  children,
}: {
  index: number
  zone: 'split' | 'pane'
  wide: boolean
  onFocus: () => void
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: zone === 'split' ? 'split' : `pane:${index}`,
  })
  return (
    <div
      className="relative flex h-full min-h-0 min-w-0"
      // Clicking into a group's body makes it the one new tabs open in, as in an editor.
      onPointerDownCapture={(e) => {
        if (!(e.target as Element).closest('[role=tablist]')) onFocus()
      }}
    >
      {children}
      <div
        ref={setNodeRef}
        aria-hidden
        className={cn(
          'pointer-events-none absolute',
          zone === 'pane' && 'inset-x-0 top-12 bottom-0',
          zone === 'split' &&
            (wide
              ? 'top-12 right-0 bottom-0 w-1/2'
              : 'inset-x-0 bottom-0 h-1/2'),
          isOver && 'border-2 border-dashed border-primary bg-primary/10',
        )}
      />
    </div>
  )
}

export function EditorArea({
  layout,
  label,
  onMove,
  onResize,
  onFocusGroup,
  children,
}: {
  layout: TabLayout
  label: (tab: TabKey) => string
  /** Drag and drop: `tab` lands at `index` of group `to`; one past the last group splits. */
  onMove: (tab: TabKey, to: number, index: number) => void
  /** The left group's new width in percent, once the divider is let go. */
  onResize: (split: number) => void
  onFocusGroup: (index: number) => void
  children: (group: TabGroup, index: number) => ReactNode
}) {
  const wide = useWide()
  const [dragging, setDragging] = useState<TabKey | null>(null)
  // A short travel before a drag starts, so a click still just selects the tab.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const split = layout.groups.length > 1

  const drop = (tab: TabKey, over: string) => {
    const from = layout.groups.findIndex((g) => g.tabs.includes(tab))
    if (over === 'split') return onMove(tab, layout.groups.length, 0)
    const zone = /^(bar|pane):(\d)$/.exec(over)
    if (zone) {
      const to = Number(zone[2])
      // Dropping a tab on its own group's body is not a move.
      if (zone[1] === 'pane' && to === from) return
      return onMove(tab, to, layout.groups[to].tabs.length)
    }
    const to = layout.groups.findIndex((g) => g.tabs.includes(over as TabKey))
    if (to !== -1 && over !== tab) {
      onMove(tab, to, layout.groups[to].tabs.indexOf(over as TabKey))
    }
  }

  const slot = (index: number) => (
    <GroupSlot
      index={index}
      zone={split ? 'pane' : 'split'}
      wide={wide}
      onFocus={() => onFocusGroup(index)}
    >
      {children(layout.groups[index], index)}
    </GroupSlot>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      onDragStart={(e) => setDragging(e.active.id as TabKey)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(e) => {
        setDragging(null)
        if (e.over) drop(e.active.id as TabKey, String(e.over.id))
      }}
    >
      <Group
        id="editor-area"
        orientation={wide ? 'horizontal' : 'vertical'}
        defaultLayout={
          split ? { left: layout.split, right: 100 - layout.split } : undefined
        }
        onLayoutChanged={(sizes, meta) => {
          if (meta.isUserInteraction && 'right' in sizes) {
            onResize(sizes.left)
          }
        }}
        className="min-h-0 min-w-0 flex-1"
      >
        <Panel id="left" minSize="15%" className="h-full">
          {slot(0)}
        </Panel>
        {split && (
          <>
            <Separator
              className={cn(
                'bg-border transition-colors outline-none hover:bg-primary focus-visible:bg-primary',
                wide ? 'w-1.5' : 'h-1.5',
              )}
            />
            <Panel id="right" minSize="15%" className="h-full">
              {slot(1)}
            </Panel>
          </>
        )}
      </Group>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rounded-md border border-border bg-background px-3 py-1.5 text-sm shadow-lattice">
            {label(dragging)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
