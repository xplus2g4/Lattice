import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, CloudUploadIcon } from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { AskPanel } from '#/components/lattice/ask-panel'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { EditorArea } from '#/components/lattice/editor-area'
import { discardDraft } from '#/components/lattice/note-editor'
import { TabGroupView } from '#/components/lattice/tab-group'
import { listMaterials, listNotes, uploadEach, uploadMaterial } from '#/lib/api'
import { useLibrary } from '#/lib/library'
import { noteLabel } from '#/lib/references'
import {
  closeTab,
  focusedTab,
  isDraftNote,
  isOpen,
  loadedTabs,
  materialTab,
  moveTab,
  noteTab,
  nudgeTab,
  openTab,
  parseTab,
  renameTab,
  resizeSplit,
  retainTabs,
  useTabLayout,
} from '#/lib/tabs'
import { useUser } from '#/lib/user'
import { cn } from '#/lib/utils'

import type { PageRange } from '#/components/lattice/material-viewer'
import type { TabKey, TabLayout } from '#/lib/tabs'

type View = 'course' | 'reader' | 'ask'

const VIEWS: Array<[View, string]> = [
  ['course', 'Course'],
  ['reader', 'Reader'],
  ['ask', 'Ask'],
]

function tabSearch(tab: TabKey) {
  const parsed = parseTab(tab)
  return parsed.kind === 'material'
    ? { material: parsed.filename }
    : { note: parsed.id }
}

export function CourseWorkspace({
  course,
  material,
  note,
  page,
  pageEnd,
  jump,
}: {
  course: string
  material?: string
  note?: string
} & PageRange) {
  const user = useUser()
  const { markOpened, markCourseOpened } = useLibrary()
  const navigate = useNavigate()
  const [layout, updateTabs] = useTabLayout(user, course)
  const requested = material
    ? materialTab(material)
    : note
      ? noteTab(note)
      : null
  const front = focusedTab(layout)
  // Below lg one column shows at a time. The columns never change with what is open,
  // so opening a tab leaves the sidebar and Ask where they are.
  const [view, setView] = useState<View>(requested ? 'reader' : 'course')

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

  // Visiting a course's workspace counts as opening it, so the home cards can order and
  // date them even when no Material was opened this visit.
  useEffect(() => {
    markCourseOpened(course)
  }, [course, markCourseOpened])

  // A bare course URL brings back the tabs left open last time.
  useEffect(() => {
    if (!requested && front) show(front, true)
  }, [requested, front, show])

  // A deleted Material's or Note's tab closes; if the URL named it, the URL moves on.
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(course),
  })
  const notes = useQuery({
    queryKey: ['notes', course, user],
    queryFn: () => listNotes(course),
  })
  useEffect(() => {
    if (!materials.data || !notes.data) return
    const names = new Set(materials.data.map((m) => m.filename))
    const ids = new Set(notes.data.map((n) => n.id))
    const next = updateTabs((l) =>
      retainTabs(l, (key) => {
        const tab = parseTab(key)
        return tab.kind === 'material'
          ? names.has(tab.filename)
          : ids.has(tab.id) || isDraftNote(tab.id)
      }),
    )
    if (requested && !isOpen(next, requested)) show(focusedTab(next), true)
  }, [materials.data, notes.data, requested, updateTabs, show])

  const label = (tab: TabKey) => {
    const parsed = parseTab(tab)
    if (parsed.kind === 'material') return parsed.filename
    if (isDraftNote(parsed.id)) return 'Untitled'
    const found = notes.data?.find((n) => n.id === parsed.id)
    return found ? noteLabel(found) : 'Note'
  }

  // Note tabs with unsaved edits: they are never unloaded, and closing one asks first.
  const [dirty, setDirty] = useState<ReadonlySet<TabKey>>(new Set())
  const onDirtyChange = useCallback((tab: TabKey, isDirty: boolean) => {
    setDirty((prev) => {
      if (prev.has(tab) === isDirty) return prev
      const next = new Set(prev)
      if (isDirty) next.add(tab)
      else next.delete(tab)
      return next
    })
  }, [])

  const close = (tab: TabKey) => {
    if (dirty.has(tab)) {
      if (!window.confirm(`Discard unsaved changes to ${label(tab)}?`)) return
      discardDraft(tab)
      onDirtyChange(tab, false)
    }
    const next = updateTabs((l) => closeTab(l, tab))
    if (tab === requested) show(focusedTab(next))
  }

  // A draft Note's first save names it: its tab, and the URL if it was in front, follow.
  const onSaved = useCallback(
    (from: TabKey, to: TabKey) => {
      updateTabs((l) => renameTab(l, from, to))
      onDirtyChange(from, false)
      if (from === requested) show(to, true)
    },
    [requested, updateTabs, onDirtyChange, show],
  )

  // After a move the moved tab is in front of the focused group, so the URL names it.
  const follow = (next: TabLayout) => {
    const tab = focusedTab(next)
    if (tab !== requested) show(tab)
  }

  const loaded = useMemo(() => loadedTabs(layout, dirty), [layout, dirty])
  const pane = (v: View) => (view === v ? 'flex' : 'hidden')

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background lg:flex-row">
      <nav
        aria-label="Workspace"
        className="flex shrink-0 items-center border-b border-border bg-card lg:hidden"
      >
        {VIEWS.map(([v, title]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'min-h-12 flex-1 border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors',
              view === v
                ? 'border-primary bg-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {title}
          </button>
        ))}
      </nav>
      <aside
        className={`${pane('course')} min-h-0 flex-1 flex-col bg-sidebar lg:flex lg:w-64 lg:flex-none lg:border-r lg:border-border xl:w-72`}
      >
        <div className="space-y-5 border-b border-border px-5 py-5">
          <Link
            to="/"
            className="fieldnotes-action inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            Home
          </Link>
          <div>
            <p className="fieldnotes-kicker mb-2 text-muted-foreground">
              Course workspace
            </p>
            <Badge
              variant="secondary"
              className="h-auto border-0 bg-transparent p-0 font-mono text-xl font-medium uppercase tracking-tight text-foreground"
            >
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
          materials.data?.length === 0 ? (
            <FirstUpload
              course={course}
              user={user}
              onUploaded={(filename) => show(materialTab(filename))}
            />
          ) : (
            <div className="fieldnotes-canvas flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm border-l-2 border-primary pl-6">
                <p className="fieldnotes-kicker mb-4 text-muted-foreground">
                  Room to think
                </p>
                <h1 className="font-editorial text-4xl leading-tight tracking-tight">
                  Start with a little reading.
                </h1>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Open a Material or Note from the sidebar to read it here.
                </p>
              </div>
            </div>
          )
        ) : (
          <EditorArea
            layout={layout}
            label={label}
            onMove={(tab, to, index) =>
              follow(updateTabs((l) => moveTab(l, tab, to, index)))
            }
            onResize={(split) => updateTabs((l) => resizeSplit(l, split))}
            onFocusGroup={(i) => {
              const active = layout.groups[i]?.active
              if (i !== layout.focused && active) show(active)
            }}
          >
            {(group, i) => (
              <TabGroupView
                index={i}
                user={user}
                course={course}
                group={group}
                loaded={loaded}
                focused={i === layout.focused}
                request={{ tab: requested, page, pageEnd, jump }}
                label={label}
                dirty={dirty}
                onSelect={(tab) => show(tab)}
                onClose={close}
                onNudge={(tab, step) =>
                  follow(updateTabs((l) => nudgeTab(l, tab, step)))
                }
                onDirtyChange={onDirtyChange}
                onSaved={onSaved}
              />
            )}
          </EditorArea>
        )}
      </main>
      <div
        className={`${pane('ask')} min-h-0 min-w-0 flex-1 flex-col bg-card lg:flex lg:w-80 lg:flex-none lg:border-l lg:border-border xl:w-96`}
      >
        <AskPanel course={course} user={user} front={front} />
      </div>
    </div>
  )
}

/**
 * The reader pane before a course has any Material: one big drop target rather than the
 * usual placeholder, so the first upload has nothing else competing for attention.
 */
function FirstUpload({
  course,
  user,
  onUploaded,
}: {
  course: string
  user: string
  onUploaded: (filename: string) => void
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const upload = useMutation({
    mutationFn: (files: Array<File>) =>
      uploadEach(files, (f) => uploadMaterial(course, f)),
    onSuccess: (results) => {
      void queryClient.invalidateQueries({
        queryKey: ['materials', course, user],
      })
      const first = results.find((r) => !r.error)
      if (first) onUploaded(first.file.name)
    },
  })
  const onFiles = (files: FileList | null) => {
    if (files?.length) upload.mutate(Array.from(files))
  }

  return (
    <div
      className={cn(
        'm-4 flex min-w-0 flex-1 flex-col items-center justify-center gap-6 border border-dashed p-6 text-center transition-colors sm:m-8',
        dragOver ? 'border-primary bg-accent' : 'border-input bg-card',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <HugeiconsIcon
        icon={CloudUploadIcon}
        className="size-9 text-primary-ink"
      />
      <div className="space-y-1">
        <p className="font-editorial text-3xl leading-tight tracking-tight">
          {upload.isPending
            ? 'Uploading…'
            : 'Drop your first slides or readings here'}
        </p>
        <p className="text-sm text-muted-foreground">
          Everyone enrolled in this course can see what you upload here.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        Choose files
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.md,.txt"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {upload.error && (
        <p className="text-sm text-destructive">{upload.error.message}</p>
      )}
      {upload.data
        ?.filter((r) => r.error)
        .map((r) => (
          <p key={r.file.name} className="text-sm text-destructive">
            {r.file.name}: {r.error}
          </p>
        ))}
    </div>
  )
}
