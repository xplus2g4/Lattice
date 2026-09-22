import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '#/components/ui/button'

import './reader-layout.css'

/** Keeps both panes mounted when switching views, so editing and PDF loading continue. */
export function ReaderLayout({
  page,
  numPages,
  canNavigate,
  onNavigate,
  notice,
  children,
  note,
}: {
  page: number
  numPages: number
  canNavigate: boolean
  onNavigate: (page: number) => void
  notice: ReactNode
  children: ReactNode
  note: ReactNode
}) {
  const [view, setView] = useState<'material' | 'note'>('material')
  const id = useId()

  return (
    <div className="reader-layout">
      <div className="reader-layout-inner" data-view={view}>
        <nav aria-label="Page navigation" className="reader-toolbar">
          <Button
            variant="outline"
            className="min-h-11 rounded-lg"
            disabled={!canNavigate || page <= 1}
            onClick={() => onNavigate(page - 1)}
          >
            <span aria-hidden="true">←</span>
            Previous<span className="sr-only"> page</span>
          </Button>
          <span
            aria-live="polite"
            className="text-center text-sm font-semibold tabular-nums"
          >
            {numPages ? `Page ${page} of ${numPages}` : 'Loading pages…'}
          </span>
          <Button
            variant="outline"
            className="min-h-11 rounded-lg"
            disabled={!canNavigate || page >= numPages}
            onClick={() => onNavigate(page + 1)}
          >
            Next<span className="sr-only"> page</span>
            <span aria-hidden="true">→</span>
          </Button>
        </nav>
        {notice && <div className="reader-notice">{notice}</div>}
        <div
          role="group"
          aria-label="Reader view"
          className="reader-view-switch"
        >
          <Button
            variant={view === 'material' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'material'}
            aria-controls={`${id}-material`}
            className="min-h-11 flex-1 rounded-lg"
            onClick={() => setView('material')}
          >
            Material
          </Button>
          <Button
            variant={view === 'note' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'note'}
            aria-controls={`${id}-note`}
            disabled={!note}
            className="min-h-11 flex-1 rounded-lg"
            onClick={() => setView('note')}
          >
            Your Note · Page {page}
          </Button>
        </div>
        <div className="reader-panes">
          <div id={`${id}-material`} className="reader-material-pane">
            {children}
          </div>
          <div id={`${id}-note`} className="reader-note-pane">
            {note || (
              <p className="p-5 text-sm text-muted-foreground">
                Your private Note will appear here when the Page is ready.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
