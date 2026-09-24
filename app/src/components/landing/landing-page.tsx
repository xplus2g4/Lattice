import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'

const notices = {
  waitlist: [
    'Good things are taking shape.',
    'Lattice is in development. The waitlist is not open yet, and no registration has been recorded. This page introduces the experience we’re working towards for NUS students.',
  ],
  campus: [
    'A course-wide connection.',
    'Campus is a proposed plan for coordinator-onboarded courses, including sponsored Plus access, aggregate learning insights, and standard onboarding support. Contact enquiries are not open yet. No request has been sent.',
  ],
  signin: [
    'A preview of signing in.',
    'Explore the planned sign-in options below. Authentication is not available on this marketing page.',
  ],
  instagram: [
    'An idea worth sharing.',
    'Download the Lattice Story image to share it yourself. Nothing is posted to Instagram from this page.',
  ],
}
const concepts = {
  vectors: [
    'Start with vectors & spaces',
    'Build an intuition for direction, magnitude, and span. These ideas support matrices and linear transformations.',
  ],
  matrices: [
    'A new way to see a matrix',
    'Connect matrix operations to the vectors they act on. This foundation leads into linear transformations.',
  ],
  transforms: [
    'From matrices to transformations',
    'Revisit how a matrix moves a vector. Then try an optional quiz to check your understanding.',
  ],
  eigenvectors: [
    'Find what stays in the same direction',
    'Revisit linear transformations before exploring eigenvectors. An optional quiz would help update your mastery state.',
  ],
  applications: [
    'Bring the connections together',
    'Use vectors, matrices, and transformations to approach a new problem. Build on the ideas you have already explored.',
  ],
}

export function LandingPage({ siteUrl }: { siteUrl: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [notice, setNotice] = useState<keyof typeof notices>('waitlist')
  const [selected, setSelected] = useState<keyof typeof concepts>('transforms')
  const [providerStatus, setProviderStatus] = useState('')
  const [storyStatus, setStoryStatus] = useState('')
  const [shareStatus, setShareStatus] = useState('')

  function openNotice(kind: keyof typeof notices) {
    setNotice(kind)
    setProviderStatus('')
    setStoryStatus('')
    dialogRef.current?.showModal()
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      event.currentTarget.close()
    }
  }

  async function copyAddress(setStatus: (status: string) => void) {
    try {
      await navigator.clipboard.writeText(siteUrl)
      setStatus('Website address copied.')
    } catch {
      setStatus(`Copy this address: ${siteUrl}`)
    }
  }

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header wrap">
        <a className="brand" href="#" aria-label="Lattice home">
          <img
            src="/landing-assets/wordmark.png"
            width="155"
            height="40"
            alt="Lattice"
          />
        </a>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <button
            className="button button-small"
            onClick={() => openNotice('waitlist')}
          >
            Join the waitlist <span aria-hidden="true">↗</span>
          </button>
        </nav>
      </header>

      <main id="main">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot"></span> A new way to learn, together
            </p>
            <h1 id="hero-title">
              See how
              <br />
              it all <em>connects.</em>
            </h1>
            <p className="hero-description">
              Your course is more than a stack of slides. Connect the concepts,
              understand what comes before, and find your next step with
              Lattice.
            </p>
            <div className="hero-actions">
              <button className="button" onClick={() => openNotice('waitlist')}>
                Join the waitlist <span aria-hidden="true">↗</span>
              </button>
              <a className="text-link" href="#features">
                Explore the idea <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="small-note">
              Designed for NUS students. Currently in development.
            </p>
            <div className="hero-footnote">
              <span className="mini-network" aria-hidden="true">
                ✳
              </span>
              <p>
                Grounded in your course.
                <br />
                <strong>Built around your understanding.</strong>
              </p>
            </div>
          </div>

          <figure className="concept-preview" aria-labelledby="preview-caption">
            <div className="workspace-bar">
              <span className="workspace-mark" aria-hidden="true">
                L
              </span>
              <span>Your learning, connected</span>
              <span className="preview-label">Product vision</span>
            </div>
            <div className="workspace-heading">
              <div>
                <p className="micro-label">A sample course</p>
                <h2>Foundations of learning</h2>
              </div>
              <span className="course-chip">Concept map</span>
            </div>
            <div
              className="map-legend"
              role="group"
              aria-label="Mastery states"
            >
              <span>
                <i className="legend-dot strong"></i>Strong
              </span>
              <span>
                <i className="legend-dot developing"></i>Developing
              </span>
              <span>
                <i className="legend-dot revisit"></i>Revisit
              </span>
            </div>
            <div
              className="concept-map"
              role="group"
              aria-label="Illustrative concept map. Select a concept to explore its connections."
            >
              <svg
                className="map-lines"
                viewBox="0 0 600 350"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M120 75 C120 160 260 70 300 175 M475 70 C475 130 340 90 300 175 M300 175 C230 235 155 210 135 290 M300 175 C390 185 470 200 480 275" />
                <path
                  className="highlight-line"
                  d="M120 75 C120 160 260 70 300 175"
                />
                <circle cx="234" cy="130" r="4" />
                <circle cx="414" cy="111" r="4" />
                <circle cx="211" cy="225" r="4" />
              </svg>
              <button
                className={`map-node node-one ${selected === 'vectors' ? 'is-selected' : ''}`}
                onClick={() => setSelected('vectors')}
                aria-pressed={selected === 'vectors'}
              >
                <span className="node-icon" aria-hidden="true">
                  ↗
                </span>
                <span>
                  Vectors &amp; spaces
                  <small>
                    <i className="legend-dot strong"></i>Strong
                  </small>
                </span>
              </button>
              <button
                className={`map-node node-two ${selected === 'matrices' ? 'is-selected' : ''}`}
                onClick={() => setSelected('matrices')}
                aria-pressed={selected === 'matrices'}
              >
                <span className="node-icon" aria-hidden="true">
                  ▦
                </span>
                <span>
                  Matrices
                  <small>
                    <i className="legend-dot strong"></i>Strong
                  </small>
                </span>
              </button>
              <button
                className={`map-node node-three ${selected === 'transforms' ? 'is-selected' : ''}`}
                onClick={() => setSelected('transforms')}
                aria-pressed={selected === 'transforms'}
              >
                <span className="node-icon" aria-hidden="true">
                  ⇄
                </span>
                <span>
                  Linear transformations
                  <small>
                    <i className="legend-dot developing"></i>Developing
                  </small>
                </span>
              </button>
              <button
                className={`map-node node-four ${selected === 'eigenvectors' ? 'is-selected' : ''}`}
                onClick={() => setSelected('eigenvectors')}
                aria-pressed={selected === 'eigenvectors'}
              >
                <span className="node-icon" aria-hidden="true">
                  ⤢
                </span>
                <span>
                  Eigenvectors
                  <small>
                    <i className="legend-dot revisit"></i>Revisit
                  </small>
                </span>
              </button>
              <button
                className={`map-node node-five ${selected === 'applications' ? 'is-selected' : ''}`}
                onClick={() => setSelected('applications')}
                aria-pressed={selected === 'applications'}
              >
                <span className="node-icon" aria-hidden="true">
                  ⌘
                </span>
                <span>
                  Applications<small>Build on the basics</small>
                </span>
              </button>
            </div>
            <div
              className="concept-detail"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="detail-icon" aria-hidden="true">
                ↳
              </div>
              <div>
                <p className="micro-label">Your next connection</p>
                <h3 id="concept-title">{concepts[selected][0]}</h3>
                <p id="concept-description">{concepts[selected][1]}</p>
              </div>
              <span className="detail-arrow" aria-hidden="true">
                ↗
              </span>
            </div>
            <figcaption id="preview-caption">
              Illustrative concept map · Select a topic to explore
            </figcaption>
          </figure>
          <div className="hero-principles">
            <p>
              <span aria-hidden="true">01 /</span> Course materials, connected
            </p>
            <p>
              <span aria-hidden="true">02 /</span> Progress through
              understanding
            </p>
            <p>
              <span aria-hidden="true">03 /</span> A clearer next step
            </p>
          </div>
        </section>

        <section
          className="features"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="wrap">
            <div className="section-intro">
              <p className="eyebrow">Learning with a little more direction</p>
              <h2 id="features-title">
                The bigger picture.
                <br />
                The next small step.
              </h2>
              <p>
                We’re building Lattice to make university learning feel
                connected—from your first concept to your next course.
              </p>
            </div>
            <article className="feature-row">
              <div className="feature-copy">
                <span className="feature-number">01 / CONNECT</span>
                <h3>
                  A course that
                  <br />
                  makes sense together.
                </h3>
                <p>
                  Turn course materials into a map of connected concepts. See
                  how each idea fits into the whole, with course structures
                  approved by your coordinator.
                </p>
                <p className="feature-aside">
                  A foundation you can trace back.
                </p>
              </div>
              <div
                className="material-visual"
                role="img"
                aria-label="Illustration: course materials and approved textbooks connect to a concept map."
              >
                <div className="material-stack">
                  <div className="paper paper-back"></div>
                  <div className="paper">
                    <span className="paper-label">COURSE MATERIAL</span>
                    <h4>Linear algebra</h4>
                    <span className="paper-line"></span>
                    <span className="paper-line short"></span>
                    <div className="paper-equation">
                      A<strong>v</strong> = λ<strong>v</strong>
                    </div>
                    <span className="paper-line"></span>
                    <span className="paper-line short"></span>
                    <p>Connected to your course</p>
                  </div>
                </div>
                <span className="visual-connector" aria-hidden="true">
                  →
                </span>
                <div className="material-result">
                  <span className="result-symbol" aria-hidden="true">
                    ✳
                  </span>
                  <strong>One connected view</strong>
                  <span>Materials + approved textbooks</span>
                  <span className="citation-pill">
                    ↗ Citations you can follow
                  </span>
                </div>
                <span className="visual-caption">
                  Illustrative product vision
                </span>
              </div>
            </article>
            <article className="feature-row feature-reverse">
              <div className="feature-copy">
                <span className="feature-number">02 / UNDERSTAND</span>
                <h3>
                  Find the missing link.
                  <br />
                  Build from there.
                </h3>
                <p>
                  See the prerequisites behind a difficult concept. Optional
                  quizzes would update your mastery states, helping you
                  distinguish what feels familiar from what you understand.
                </p>
                <p className="feature-aside">Progress, at your own pace.</p>
              </div>
              <div className="mastery-visual">
                <div className="mini-heading">
                  <span>Understanding, in focus</span>
                  <span className="tiny-label">SAMPLE</span>
                </div>
                <div className="mastery-item">
                  <span className="mastery-check" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <strong>Vectors &amp; spaces</strong>
                    <span>A foundation to build on</span>
                  </div>
                  <span className="badge badge-strong">Strong</span>
                </div>
                <div className="mastery-link" aria-hidden="true"></div>
                <div className="mastery-item">
                  <span
                    className="mastery-check developing-check"
                    aria-hidden="true"
                  >
                    ◒
                  </span>
                  <div>
                    <strong>Linear transformations</strong>
                    <span>A little more practice</span>
                  </div>
                  <span className="badge badge-developing">Developing</span>
                </div>
                <div className="mastery-callout">
                  <span aria-hidden="true">↳</span>
                  <p>
                    A prerequisite exercise helps you work through the gap. An
                    optional quiz checks your understanding.
                  </p>
                </div>
                <span className="visual-caption">
                  Illustrative mastery states
                </span>
              </div>
            </article>
            <article className="feature-row">
              <div className="feature-copy">
                <span className="feature-number">03 / KEEP GOING</span>
                <h3>
                  Less “where do I start?”
                  <br />
                  More moving forward.
                </h3>
                <p>
                  A personal revision dashboard would turn your quiz results
                  into a recommended sequence. Revisit the foundations, connect
                  the next idea, and see a path through your course.
                </p>
                <p className="feature-aside">
                  Your next step, grounded in your progress.
                </p>
              </div>
              <div className="revision-visual">
                <div className="mini-heading">
                  <span>Your next steps</span>
                  <span className="tiny-label">SAMPLE PLAN</span>
                </div>
                <ol className="revision-list">
                  <li>
                    <span className="step-index">1</span>
                    <div>
                      <strong>Revisit vector spaces</strong>
                      <span>Strengthen the prerequisite</span>
                    </div>
                    <span className="step-tag">Start here</span>
                  </li>
                  <li>
                    <span className="step-index">2</span>
                    <div>
                      <strong>Connect transformations</strong>
                      <span>Build on the foundation</span>
                    </div>
                    <span aria-hidden="true">↗</span>
                  </li>
                  <li>
                    <span className="step-index">3</span>
                    <div>
                      <strong>Try a mastery quiz</strong>
                      <span>Optional, always</span>
                    </div>
                    <span aria-hidden="true">↗</span>
                  </li>
                </ol>
                <div className="revision-note">
                  <span className="status-dot"></span> A sequence shaped by your
                  understanding
                </div>
                <span className="visual-caption">
                  Illustrative revision dashboard
                </span>
              </div>
            </article>
            <div className="course-note">
              <span className="note-mark" aria-hidden="true">
                i
              </span>
              <div>
                <strong>Your course comes first.</strong>
                <p>
                  Course access and student uploads begin only after your
                  coordinator onboards the course with our team. Guidance is
                  designed to cite course materials and coordinator-listed
                  textbooks, drawing on those textbooks when a Material falls
                  short. Lecturers see aggregate results only.
                </p>
                <p className="petition-note">
                  Course not available? Student petitions will help prioritise
                  future onboarding. Requests are not open yet.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="pricing wrap"
          id="pricing"
          aria-labelledby="pricing-title"
        >
          <div className="pricing-heading">
            <div>
              <p className="eyebrow">Room to grow</p>
              <h2 id="pricing-title">
                Start with curiosity.
                <br />
                Go further when you’re ready.
              </h2>
            </div>
            <p>
              Proposed plans, designed around student life.
              <br />
              All prices in Singapore dollars.
            </p>
          </div>
          <div className="price-grid">
            <article className="price-card">
              <p className="plan-audience">For a first connection</p>
              <h3>Free</h3>
              <p className="price">
                S$0<span> / month</span>
              </p>
              <p className="plan-description">
                The foundations of connected learning.
              </p>
              <ul className="plan-list">
                <li>Concept maps &amp; prerequisites</li>
                <li>Basic mastery tracking</li>
                <li>Private notes &amp; a basic revision dashboard</li>
                <li>
                  <strong>3</strong> AI study-plan updates / month
                </li>
              </ul>
              <button
                className="button button-outline"
                onClick={() => openNotice('waitlist')}
              >
                Join the waitlist <span aria-hidden="true">↗</span>
              </button>
            </article>
            <article className="price-card price-featured">
              <div className="plan-topline">
                <p className="plan-audience">For a clearer study rhythm</p>
                <span className="plan-badge">More personal</span>
              </div>
              <h3>Plus</h3>
              <p className="price">
                S$6.90<span> / month</span>
              </p>
              <p className="semester-price">
                Or S$24 for a four-month semester
              </p>
              <ul className="plan-list">
                <li>Everything in Free</li>
                <li>Detailed personal revision sequences</li>
                <li>Progress history &amp; exam-date planning</li>
                <li>
                  <strong>20</strong> AI study-plan updates / month
                </li>
              </ul>
              <button className="button" onClick={() => openNotice('waitlist')}>
                Join the waitlist <span aria-hidden="true">↗</span>
              </button>
            </article>
            <article className="price-card">
              <p className="plan-audience">For a whole course</p>
              <h3>Campus</h3>
              <p className="campus-price">
                Learning,
                <br />
                supported together.
              </p>
              <p className="plan-description">contact us for course pricings</p>
              <ul className="plan-list">
                <li>Plus in one sponsored course</li>
                <li>Lecturer course-management tools</li>
                <li>Aggregate cohort learning insights</li>
                <li>Standard team-led onboarding</li>
              </ul>
              <button
                className="button button-outline"
                onClick={() => openNotice('campus')}
              >
                About Campus <span aria-hidden="true">↗</span>
              </button>
            </article>
          </div>
          <p className="pricing-footnote">
            Plans and features are proposed. Plus does not unlock unsupported
            courses. Campus-sponsored students do not pay again for that course.
            Advanced integrations and extensive onboarding are quoted
            separately.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-main">
            <div>
              <a className="brand" href="#" aria-label="Lattice home">
                <img
                  src="/landing-assets/wordmark.png"
                  width="155"
                  height="40"
                  alt="Lattice"
                  loading="lazy"
                />
              </a>
              <p>Make connections. Keep learning.</p>
            </div>
            <div className="footer-share">
              <p className="micro-label">Pass the idea along</p>
              <div>
                <a
                  id="telegram-share"
                  href={`https://t.me/share/url?url=${encodeURIComponent(siteUrl)}&text=See%20how%20it%20all%20connects%20with%20Lattice.`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Telegram <span aria-hidden="true">↗</span>
                </a>
                <button onClick={() => openNotice('instagram')}>
                  Instagram Story <span aria-hidden="true">↗</span>
                </button>
                <button
                  id="copy-link"
                  onClick={() => void copyAddress(setShareStatus)}
                >
                  Copy link <span aria-hidden="true">↗</span>
                </button>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© 2026 Lattice · A student-built product in development</p>
            <button className="text-link" onClick={() => openNotice('signin')}>
              Sign-in preview <span aria-hidden="true">↗</span>
            </button>
          </div>
          <p id="share-status" className="share-status" role="status">
            {shareStatus}
          </p>
        </div>
      </footer>

      <dialog
        ref={dialogRef}
        id="info-dialog"
        onClick={closeOnBackdrop}
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        <div className="dialog-inner">
          <button
            onClick={() => dialogRef.current?.close()}
            className="close-dialog"
            aria-label="Close dialog"
          >
            ×
          </button>
          <p className="eyebrow" id="dialog-eyebrow">
            Lattice / In development
          </p>
          <h2 id="dialog-title">{notices[notice][0]}</h2>
          <p id="dialog-description">{notices[notice][1]}</p>
          <div id="signin-options" hidden={notice !== 'signin'}>
            <p className="demo-notice">
              Demo only. These buttons do not sign you in, create an account, or
              share any information with a provider.
            </p>
            <div className="provider-list">
              <button
                onClick={() =>
                  setProviderStatus(
                    'Google sign-in is a demo only. You have not been signed in, and no account information has been collected.',
                  )
                }
              >
                <span className="provider-letter" aria-hidden="true">
                  G
                </span>
                Continue with Google<span aria-hidden="true">↗</span>
              </button>
              <button
                onClick={() =>
                  setProviderStatus(
                    'Microsoft sign-in is a demo only. You have not been signed in, and no account information has been collected.',
                  )
                }
              >
                <span className="microsoft-mark" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
                Continue with Microsoft<span aria-hidden="true">↗</span>
              </button>
              <button
                onClick={() =>
                  setProviderStatus(
                    'GitHub sign-in is a demo only. You have not been signed in, and no account information has been collected.',
                  )
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 .7a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.5-1.3-1.3-1.6-1.3-1.6-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.4-1.3-5.4-5.8 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.2-3.2 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.9 0c2.2-1.5 3.2-1.2 3.2-1.2.7 1.7.3 2.9.2 3.2.8.8 1.2 1.9 1.2 3.2 0 4.5-2.7 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3c0 .3.2.6.8.5A11.4 11.4 0 0 0 12 .7Z"
                  />
                </svg>
                Continue with GitHub<span aria-hidden="true">↗</span>
              </button>
            </div>
            <p id="provider-status" role="status">
              {providerStatus}
            </p>
          </div>
          <div id="story-options" hidden={notice !== 'instagram'}>
            <a
              className="button"
              href="/landing-assets/instagram-story.png"
              download="lattice-instagram-story.png"
            >
              Download Story image <span aria-hidden="true">↓</span>
            </a>
            <p className="small-note">
              Save the image, add it to an Instagram Story, and use a link
              sticker with the address below.
            </p>
            <label htmlFor="story-url">Website address</label>
            <input id="story-url" readOnly value={siteUrl} />
            <button
              className="text-link"
              id="story-copy"
              onClick={() => void copyAddress(setStoryStatus)}
            >
              Copy website address
            </button>
            <p id="story-status" role="status">
              {storyStatus}
            </p>
          </div>
          <button
            onClick={() => dialogRef.current?.close()}
            className="button dialog-done"
          >
            Got it <span aria-hidden="true">✓</span>
          </button>
        </div>
      </dialog>
      <noscript>
        <p className="noscript-note">
          This is a product preview. Waitlist, course requests, Campus contact,
          and sign-in are informational only; no information is collected.
          JavaScript enables the concept-map preview and information dialogs.
        </p>
      </noscript>
    </div>
  )
}
