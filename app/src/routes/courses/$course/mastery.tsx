import { Link, createFileRoute } from '@tanstack/react-router'

import { Icon, PageHeading } from '#/components/common'

export const Route = createFileRoute('/courses/$course/mastery')({
  component: Mastery,
})

function Mastery() {
  const { course } = Route.useParams()
  return (
    <div className="page">
      <PageHeading
        eyebrow={`${course.toUpperCase()} / THE BIGGER PICTURE`}
        title="Mastery hub"
        description="Understanding is more than a progress bar."
      />
      <section className="mastery-intro panel">
        <span className="empty-icon">
          <Icon name="graph" size={32} />
        </span>
        <span className="tag">PLANNED · NOT YET AVAILABLE</span>
        <h2>
          Connect what you know.
          <br />
          Discover what comes next.
        </h2>
        <p>
          Concept connections, quiz results, and mastery scores need
          capabilities that are not yet available in the API. Your Materials and
          Notes are ready for study, but we do not infer mastery from activity.
        </p>
        <Link
          className="button button-primary"
          to="/courses/$course/ask"
          params={{ course }}
        >
          Explore a question instead
          <Icon name="arrow" size={16} />
        </Link>
      </section>
      <div className="feature-grid">
        <section className="panel feature-card">
          <Icon name="graph" />
          <h3>Related concepts</h3>
          <p>
            Planned for Phase 2: course concepts connected through the concept
            graph, not invented by the LLM.
          </p>
        </section>
        <section className="panel feature-card">
          <Icon name="note" />
          <h3>Note evaluation</h3>
          <p>
            You can save and ask about private Notes today. Automated evaluation
            and feedback are not available yet.
          </p>
        </section>
        <section className="panel feature-card">
          <Icon name="check" />
          <h3>Practice & progress</h3>
          <p>
            Scored quizzes and persistent mastery tracking are planned. No
            scores are recorded in the current app.
          </p>
        </section>
      </div>
    </div>
  )
}
