import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { AskPanel } from '#/components/lattice/ask-panel'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { TabGroupView } from '#/components/lattice/tab-group'
import { listMaterials } from '#/lib/api'
import { useLibrary } from '#/lib/library'
import {
  closeTab,
  focusedTab,
  isOpen,
  loadedTabs,
  materialTab,
  openTab,
  parseTab,
  retainTabs,
  useTabLayout,
} from '#/lib/tabs'
import { useUser } from '#/lib/user'
import { cn } from '#/lib/utils'

import type { PageRange } from '#/components/lattice/material-viewer'
import type { TabKey } from '#/lib/tabs'

type View = 'course' | 'reader' | 'ask'

const VIEWS: Array<[View, string]> = [
  ['course', 'Course'],
  ['reader', 'Reader'],
  ['ask', 'Ask'],
]

function tabSearch(tab: TabKey) {
  const parsed = parseTab(tab)
  return parsed.kind === 'material' ? { material: parsed.filename } : {}
}

export function CourseWorkspace({
  course,
  material,
  page,
  pageEnd,
  jump,
}: {
  course: string
  material?: string
} & PageRange) {
  const [user] = useUser()
  const { markOpened } = useLibrary()
  const navigate = useNavigate()
  const [layout, updateTabs] = useTabLayout(user, course)
  const requested = material ? materialTab(material) : null
  const front = focusedTab(layout)
  // Below lg one column shows at a time. The columns never change with what is open,
  // so opening a tab leaves the sidebar and Ask where they are.
  const [view, setView] = useState<View>(material ? 'reader' : 'course')

  const show = useCallback(
    (tab: TabKey | null, replace = false) =>
      void navigate({
        to: '/courses/$course',
        params: { course },
        search: tab ? tabSearch(tab) : {},
        replace,
      }),
    [course, navigate],
  )

  // The URL names the tab in front. Opening is idempotent, so a sidebar row, a citation
  // and a tab click all arrive here; nothing else opens a tab.
  useEffect(() => {
    if (!requested) return
    updateTabs((l) => openTab(l, requested))
    setView('reader')
  }, [requested, jump, updateTabs])

  useEffect(() => {
    if (material) markOpened(course, material)
  }, [course, material, markOpened])

  // A bare course URL brings back the tabs left open last time.
  useEffect(() => {
    if (!requested && front) show(front, true)
  }, [requested, front, show])

  // A deleted Material's tab closes; if the URL named it, the URL moves on.
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(user, course),
  })
  useEffect(() => {
    if (!materials.data) return
    const names = new Set(materials.data.map((m) => m.filename))
    const next = updateTabs((l) =>
      retainTabs(l, (key) => {
        const tab = parseTab(key)
        return tab.kind !== 'material' || names.has(tab.filename)
      }),
    )
    if (requested && !isOpen(next, requested)) show(focusedTab(next), true)
  }, [materials.data, requested, updateTabs, show])

  const close = (tab: TabKey) => {
    const next = updateTabs((l) => closeTab(l, tab))
    if (tab === requested) show(focusedTab(next))
  }

  const loaded = useMemo(() => loadedTabs(layout), [layout])
  const pane = (v: View) => (view === v ? 'flex' : 'hidden')

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background lg:flex-row">
      <nav
        aria-label="Workspace"
        className="flex items-center gap-1 border-b border-border p-1.5 lg:hidden"
      >
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              view === v
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <aside
        className={`${pane('course')} min-h-0 flex-1 flex-col bg-sidebar lg:flex lg:w-80 lg:flex-none lg:border-r lg:border-border`}
      >
        <div className="space-y-2 border-b border-border p-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            Home
          </Link>
          <div className="px-1">
            <Badge variant="secondary" className="font-mono uppercase">
              {course}
            </Badge>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MaterialsPanel course={course} user={user} />
          <NotesPanel course={course} user={user} />
        </div>
      </aside>
      <main className={`${pane('reader')} min-h-0 min-w-0 flex-1 lg:flex`}>
        {layout.groups[0].tabs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Open a Material from the sidebar to read it here.
          </div>
        ) : (
          layout.groups.map((group, i) => (
            <TabGroupView
              key={i}
              user={user}
              course={course}
              group={group}
              loaded={loaded}
              focused={i === layout.focused}
              request={{ tab: requested, page, pageEnd, jump }}
              onSelect={(tab) => show(tab)}
              onClose={close}
            />
          ))
        )}
      </main>
      <div
        className={`${pane('ask')} min-h-0 min-w-0 flex-1 flex-col lg:flex lg:w-80 lg:flex-none lg:border-l lg:border-border xl:w-96`}
      >
        <AskPanel course={course} user={user} />
      </div>
    </div>
  )
}
