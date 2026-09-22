import { HttpResponse, http } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Ask } from '#/components/ask'
import { assistantTurn, evidence, session, tierResult } from '#/test/fixtures'
import { answerNextAskWith, resetStore } from '#/test/handlers'
import { server } from '#/test/server'
import { renderWithQuery } from '#/test/render'

const COURSE = 'cs101'
const USER = 'alice@example.com'

// The conversation id belongs to the route now, so the tests need the same small amount
// of state the route holds: start a conversation and you are reading it, leave it and you
// are back to a blank one.
function Conversation({ openAt }: { openAt: string | null }) {
  const [sessionId, setSessionId] = useState<string | null>(openAt)
  return (
    <Ask
      course={COURSE}
      user={USER}
      sessionId={sessionId}
      onSessionStarted={setSessionId}
      onLeaveSession={() => setSessionId(null)}
    />
  )
}

function show(openAt: string | null = null) {
  return renderWithQuery(<Conversation openAt={openAt} />)
}

async function askAbout(question: string) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/Ask a question/), question)
  await user.click(screen.getByRole('button', { name: 'Ask' }))
  return user
}

describe('asking a question', () => {
  it('shows the answer for each tier it searched', async () => {
    answerNextAskWith(
      assistantTurn({
        results: [
          tierResult({
            tier: 'global',
            answer: 'Buckets and a hash function.',
          }),
          tierResult({
            tier: 'private',
            answer: 'You wrote that week 3 covers this.',
          }),
        ],
      }),
    )
    show()

    await askAbout('what is a hash table?')

    expect(await screen.findByText('Course materials')).toBeInTheDocument()
    expect(screen.getByText('Buckets and a hash function.')).toBeInTheDocument()
    expect(screen.getByText('Your notes')).toBeInTheDocument()
    expect(
      screen.getByText('You wrote that week 3 covers this.'),
    ).toBeInTheDocument()
  })

  it('echoes the question back as part of the conversation', async () => {
    show()

    await askAbout('what is a hash table?')

    expect(
      await screen.findByText('what is a hash table?', { exact: false }),
    ).toBeInTheDocument()
  })

  it('keeps the echoed question after the session is re-read from the API', async () => {
    show()

    await askAbout('what is a hash table?')
    await screen.findByText('what is a hash table?', { exact: false })

    // The optimistic echo is written into the cache under the session id the server
    // chose; if that key were wrong the refetch would replace it and the question would
    // vanish a moment later.
    await waitFor(() =>
      expect(screen.getByText(/session sess-1/)).toBeInTheDocument(),
    )
    expect(
      screen.getByText('what is a hash table?', { exact: false }),
    ).toBeInTheDocument()
  })

  it('clears the box so the next question can be typed', async () => {
    show()

    await askAbout('what is a hash table?')

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Ask a question/)).toHaveValue(''),
    )
  })

  it('reports an API failure instead of a blank answer', async () => {
    server.use(
      http.post('*/ask', () =>
        HttpResponse.json(
          { detail: 'RuntimeError: cognify never ran' },
          { status: 502 },
        ),
      ),
    )
    show()

    await askAbout('what is a hash table?')

    expect(
      await screen.findByText('RuntimeError: cognify never ran'),
    ).toBeInTheDocument()
  })
})

describe('an answer with nothing behind it', () => {
  it('says so when no tier returned anything', async () => {
    answerNextAskWith(assistantTurn({ results: [] }))
    show()

    await askAbout('what is a hash table?')

    expect(
      await screen.findByText('Nothing cognified in this course yet.'),
    ).toBeInTheDocument()
  })

  it('marks a tier that searched but could not answer', async () => {
    answerNextAskWith(
      assistantTurn({ results: [tierResult({ answer: null, citations: [] })] }),
    )
    show()

    await askAbout('what is a hash table?')

    expect(await screen.findByText('no answer')).toBeInTheDocument()
  })
})

describe('the evidence behind an answer', () => {
  it('names the document and chunk a passage came from', async () => {
    answerNextAskWith(
      assistantTurn({
        results: [
          tierResult({
            citations: [evidence({ filename: 'week1.pdf', chunk_index: 3 })],
          }),
        ],
      }),
    )
    show()

    await askAbout('what is a hash table?')

    expect(await screen.findByText('week1.pdf #3 · chunk')).toBeInTheDocument()
  })

  it('names the relationship a graph edge came from', async () => {
    answerNextAskWith(
      assistantTurn({
        results: [
          tierResult({
            citations: [
              evidence({
                kind: 'relation',
                relation: 'prerequisite_of',
              }),
            ],
          }),
        ],
      }),
    )
    show()

    await askAbout('what is a hash table?')

    expect(
      await screen.findByText('prerequisite_of · edge'),
    ).toBeInTheDocument()
  })
})

describe('an existing conversation', () => {
  it('reopens where it left off', async () => {
    resetStore({
      sessions: {
        'sess-earlier': session({
          id: 'sess-earlier',
          turns: [
            assistantTurn({
              results: [tierResult({ answer: 'Earlier answer.' })],
            }),
          ],
        }),
      },
    })

    show('sess-earlier')

    expect(await screen.findByText('Earlier answer.')).toBeInTheDocument()
  })

  it('is abandoned when the API no longer knows it', async () => {
    show('sess-gone')

    await waitFor(() =>
      expect(screen.queryByText(/session sess-gone/)).not.toBeInTheDocument(),
    )
  })

  it('does not show a 404 for the forgotten conversation as an error', async () => {
    show('sess-gone')

    await waitFor(() =>
      expect(screen.queryByText(/session sess-gone/)).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('no such session')).not.toBeInTheDocument()
  })

  it('starts a fresh conversation on request', async () => {
    const user = userEvent.setup()
    show()
    await askAbout('what is a hash table?')
    await screen.findByText(/session sess-1/)

    await user.click(screen.getByRole('button', { name: 'New session' }))

    expect(screen.queryByText(/session sess-1/)).not.toBeInTheDocument()
  })
})
