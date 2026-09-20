import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  EmptyState,
  ErrorLine,
  Icon,
  PageHeading,
  StatusBadge,
  pollWhilePending,
} from '#/components/common'
import { listMaterials, listNotes } from '#/lib/api'
import type { Material, Note } from '#/lib/api'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const { course } = Route.useParams()
  const [user] = useUser()
  const [search, setSearch] = useState('')
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(user, course),
    refetchInterval: (q) => pollWhilePending<Material>(q.state.data),
  })
  const notes = useQuery({
    queryKey: ['notes', course, user],
    queryFn: () => listNotes(user, course),
    refetchInterval: (q) => pollWhilePending<Note>(q.state.data),
  })
  const filtered =
    materials.data?.filter((m) =>
      m.filename.toLowerCase().includes(search.toLowerCase()),
    ) ?? []
  const ready = materials.data?.filter((m) => m.status === 'ready').length

  return (
    <div className="page dashboard-page">
      <PageHeading
        eyebrow={`${course.toUpperCase()} / YOUR LEARNING SPACE`}
        title="My learning dashboard"
        description="Your course knowledge, connected. Pick up where your curiosity takes you."
      >
        <Link
          className="button button-secondary"
          to="/courses/$course/materials"
          params={{ course }}
        >
          <Icon name="plus" />
          Add Material
        </Link>
      </PageHeading>
      <section className="study-banner">
        <div>
          <span className="eyebrow">Make room for a little understanding</span>
          <h2>Your next “aha” starts here.</h2>
          <p>
            Explore your Materials, connect ideas, and ask the questions that
            move you forward.
          </p>
          <Link
            className="button button-primary"
            to="/courses/$course/ask"
            params={{ course }}
          >
            Start studying
            <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="knowledge-art" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="art-node node-book">
            <Icon name="book" size={26} />
          </span>
          <span className="art-node node-note">
            <Icon name="note" size={24} />
          </span>
          <span className="art-node node-spark">
            <Icon name="spark" size={30} />
          </span>
          <span className="art-label">Connect the dots.</span>
        </div>
      </section>
      <div className="stats-row" aria-label="Course knowledge summary">
        <div className="stat">
          <span className="stat-icon blue">
            <Icon name="book" />
          </span>
          <div>
            <strong>
              {materials.isError ? '—' : (materials.data?.length ?? '…')}
            </strong>
            <span>Course Materials</span>
          </div>
          <span className="stat-detail">Global tier</span>
        </div>
        <div className="stat">
          <span className="stat-icon violet">
            <Icon name="note" />
          </span>
          <div>
            <strong>{notes.isError ? '—' : (notes.data?.length ?? '…')}</strong>
            <span>Personal Notes</span>
          </div>
          <Icon name="lock" size={14} />
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Icon name="check" />
          </span>
          <div>
            <strong>{materials.isError ? '—' : (ready ?? '…')}</strong>
            <span>Materials ready to ask</span>
          </div>
          <span className="stat-detail">Cognified</span>
        </div>
      </div>
      <div className="dashboard-columns">
        <section className="panel material-panel">
          <header className="panel-heading">
            <div>
              <h2>Course Materials</h2>
              <p className="muted">The foundation for your next discovery.</p>
            </div>
            <Link
              className="text-link"
              to="/courses/$course/materials"
              params={{ course }}
            >
              View all
              <Icon name="arrow" size={14} />
            </Link>
          </header>
          <label className="search-field">
            <Icon name="search" />
            <input
              aria-label="Search Materials"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Materials in this course…"
            />
          </label>
          <ErrorLine error={materials.error} />
          {materials.isPending && (
            <p className="loading-line" role="status">
              Loading Materials…
            </p>
          )}
          {materials.isSuccess && filtered.length === 0 && (
            <EmptyState
              title={
                search
                  ? 'No matching Materials.'
                  : 'A fresh start for this course.'
              }
            >
              {' '}
              {search
                ? 'Try another Material name.'
                : 'Add your first Material to start building course knowledge.'}
            </EmptyState>
          )}
          <ul className="resource-list">
            {filtered.slice(0, 5).map((m) => (
              <li key={m.filename}>
                <span className="file-icon">
                  <Icon name="file" />
                </span>
                <div className="resource-info">
                  <strong>{m.filename}</strong>
                  <span>Course Material · Global tier</span>
                </div>
                <StatusBadge status={m.status} />
              </li>
            ))}
          </ul>
          <footer className="panel-footer">
            <Icon name="lock" size={14} />
            Course questions never cross into another course.
          </footer>
        </section>
        <div className="dashboard-right">
          <section className="panel">
            <header className="panel-heading">
              <div>
                <h2>Your thinking space</h2>
                <p className="muted">
                  Private Notes, connected to your learning.
                </p>
              </div>
              <Icon name="note" />
            </header>
            <ErrorLine error={notes.error} />
            {notes.isPending && (
              <p className="loading-line" role="status">
                Loading Notes…
              </p>
            )}
            {notes.isSuccess && notes.data.length === 0 && (
              <p className="card-copy">
                An idea, a question, a connection. Write it down and bring it
                into your next Session.
              </p>
            )}
            <ul className="note-preview-list">
              {notes.data?.slice(0, 3).map((n) => (
                <li key={n.id}>
                  <Link to="/courses/$course/notes" params={{ course }}>
                    <strong>{n.id}</strong>
                    <span>{n.body_md.slice(0, 85)}</span>
                  </Link>
                  <StatusBadge status={n.status} />
                </li>
              ))}
            </ul>
            <Link
              className="button button-secondary full-width"
              to="/courses/$course/notes"
              params={{ course }}
            >
              <Icon name="note" size={16} />
              Open Notes
              <Icon name="arrow" size={16} />
            </Link>
          </section>
          <section className="coming-card">
            <span className="tag">ON THE HORIZON</span>
            <Icon name="graph" size={25} />
            <h2>See the bigger picture.</h2>
            <p>
              Related concepts and mastery tracking are planned. For now,
              explore the evidence behind each answer.
            </p>
            <Link
              className="text-link"
              to="/courses/$course/mastery"
              params={{ course }}
            >
              About the Mastery hub
              <Icon name="arrow" size={14} />
            </Link>
          </section>
        </div>
      </div>
      <p className="page-footnote">
        One course. Two knowledge tiers. A clearer understanding.
      </p>
    </div>
  )
}
