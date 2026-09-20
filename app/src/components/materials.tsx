import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { listMaterials, uploadMaterial } from '#/lib/api'
import type { Material } from '#/lib/api'
import {
  EmptyState,
  ErrorLine,
  Icon,
  PageHeading,
  StatusBadge,
  buttonClass,
  pollWhilePending,
} from '#/components/common'
import type { Scope } from '#/components/common'

export function Materials({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const key = ['materials', course, user]
  const materials = useQuery({
    queryKey: key,
    queryFn: () => listMaterials(user, course),
    refetchInterval: (q) => pollWhilePending<Material>(q.state.data),
  })
  const [file, setFile] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const upload = useMutation({
    mutationFn: (f: File) => uploadMaterial(user, course, f),
    onSuccess: () => {
      setFile(null)
      form.current?.reset()
      dialog.current?.close()
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const chooseFile = (next: File | null) => {
    const accepted = !next || /\.(pdf|pptx|md|txt)$/i.test(next.name)
    setFile(accepted ? next : null)
    setFileError(
      accepted ? null : 'Choose a PDF, PPTX, Markdown, or text Material.',
    )
  }
  const filtered =
    materials.data?.filter((m) =>
      m.filename.toLowerCase().includes(search.toLowerCase()),
    ) ?? []

  return (
    <section className="page">
      <PageHeading
        eyebrow={`${course.toUpperCase()} / GLOBAL TIER`}
        title="Course Materials"
        description="A shared foundation. Bring your course knowledge into focus."
      >
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            upload.reset()
            setFileError(null)
            setFile(null)
            form.current?.reset()
            dialog.current?.showModal()
          }}
        >
          <Icon name="plus" />
          Add Material
        </button>
      </PageHeading>
      <div className="info-strip">
        <Icon name="book" />
        <p>
          Materials belong to this course’s global tier. Cognify makes them
          available to your study Sessions.
        </p>
      </div>
      <section className="panel">
        <header className="panel-heading">
          <h2>
            Material library{' '}
            <span className="count-badge">{materials.data?.length ?? '—'}</span>
          </h2>
          <label className="search-field compact">
            <Icon name="search" size={16} />
            <input
              aria-label="Search Materials"
              placeholder="Search Materials…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>
        <ErrorLine error={materials.error} />
        {materials.isPending && (
          <p className="loading-line" role="status">
            Loading Materials…
          </p>
        )}
        {materials.isSuccess && filtered.length === 0 && (
          <EmptyState
            title={search ? 'No matching Materials.' : 'No materials yet.'}
          >
            {search
              ? 'Try another Material name.'
              : 'Add lecture slides, a tutorial, or a memo to get started.'}
          </EmptyState>
        )}
        <ul className="resource-list">
          {filtered.map((m) => (
            <li key={m.filename}>
              <span className="file-icon">
                <Icon name="file" size={22} />
              </span>
              <div className="resource-info">
                <strong>{m.filename}</strong>
                <span>
                  {m.filename.split('.').pop()?.toUpperCase()} · Global tier
                </span>
                {m.status === 'failed' && m.error && (
                  <p className="error-line">{m.error}</p>
                )}
              </div>
              <StatusBadge status={m.status} />
            </li>
          ))}
        </ul>
        <footer className="panel-footer">
          <Icon name="spark" size={15} />
          Statuses update automatically while Materials are queued or
          cognifying.
        </footer>
      </section>
      <div className="quiet-notice">
        <Icon name="file" />
        <p>
          Material previews and slide-by-slide navigation are not available yet.
          Ask about ready Materials in Study mode.
        </p>
      </div>
      <dialog
        ref={dialog}
        className="upload-dialog"
        aria-labelledby="upload-title"
        onCancel={(e) => {
          if (upload.isPending) e.preventDefault()
        }}
      >
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault()
            if (file && !upload.isPending) upload.mutate(file)
          }}
        >
          <header className="dialog-heading">
            <span className="empty-icon">
              <Icon name="upload" size={22} />
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Close upload"
              disabled={upload.isPending}
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </header>
          <h2 id="upload-title">Add a course Material</h2>
          <p className="muted">
            More knowledge. Better questions. Clearer answers.
          </p>
          <label className="field-label">
            Course
            <input className="field" value={course.toUpperCase()} readOnly />
          </label>
          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (!upload.isPending) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (!upload.isPending) chooseFile(e.dataTransfer.files.item(0))
            }}
          >
            <Icon name="upload" size={28} />
            <strong>{file ? file.name : 'Drop a Material here'}</strong>
            <span className="muted">or choose one from your computer</span>
            <label className="button button-secondary file-picker">
              Choose Material
              <input
                aria-label="Choose Material"
                type="file"
                accept=".pdf,.pptx,.md,.txt"
                disabled={upload.isPending}
                onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <small>PDF, PPTX, Markdown, or text</small>
          </div>
          <div className="info-strip small">
            <Icon name="book" size={16} />
            <p>
              Shared in the global tier. Use Notes for your private writing. An
              existing Material with the same name will be replaced.
            </p>
          </div>
          <ErrorLine error={fileError} />
          <ErrorLine error={upload.error} />
          <footer className="dialog-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={upload.isPending}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className={buttonClass}
              type="submit"
              disabled={!file || upload.isPending}
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </footer>
        </form>
      </dialog>
    </section>
  )
}
