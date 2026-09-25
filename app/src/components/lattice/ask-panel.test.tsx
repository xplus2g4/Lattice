import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import {
  assistantTurn,
  evidence,
  material,
  note,
  session,
  tierResult,
  userTurn,
} from '#/test/fixtures'
import { answerNextAskWith, resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'
import { server } from '#/test/server'

function withAnswer(answer: string, citations = [evidence()]) {
  resetStore({
    materials: [material({ filename: 'week1.pdf' })],
    sessions: {
      'sess-1': session({
        turns: [
          userTurn('what is hashing?'),
          assistantTurn({ results: [tierResult({ answer, citations })] }),
        ],
      }),
    },
  })
  localStorage.setItem('lattice.session.cs101.alice@example.com', 'sess-1')
  return renderRoute('/courses/cs101')
}

describe('an answer', () => {
  it('renders Markdown and math', async () => {
    withAnswer(
      '**Hashing** maps keys:\n\n- one\n- two\n\nwith load \\(\\alpha = n/m\\) and $$h(k) = k \\bmod m$$',
    )

    expect(await screen.findByText('Hashing')).toHaveProperty(
      'tagName',
      'STRONG',
    )
    expect(screen.getByText('one').tagName).toBe('LI')
    expect(document.querySelectorAll('.katex').length).toBe(2)
  })

  it('does not render raw HTML from the answer', async () => {
    withAnswer('<img src=x onerror=alert(1)> plain')

    expect(await screen.findByText(/plain/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('lists references apart from the answer, linking to the cited Pages', async () => {
    withAnswer('See the slides.', [
      evidence({ filename: 'a'.repeat(64), page_start: 3, page_end: 4 }),
      evidence({
        filename: 'a'.repeat(64),
        chunk_id: 'c2',
        page_start: 9,
      }),
      evidence({ kind: 'relation', filename: null, relation: 'uses' }),
    ])

    expect(await screen.findByText('Citations')).toBeInTheDocument()
    const range = screen.getByRole('link', { name: 'week1.pdf, p. 3–4' })
    expect(range.getAttribute('href')).toBe(
      '/courses/cs101?material=week1.pdf&page=3&pageEnd=4',
    )
    expect(
      screen
        .getByRole('link', { name: 'week1.pdf, p. 9' })
        .getAttribute('href'),
    ).toBe('/courses/cs101?material=week1.pdf&page=9')
    expect(
      screen.getByText(/Related concepts/).parentElement,
    ).toHaveTextContent('uses')
  })

  it('shows a related course under its code, its references opening that reader in a new tab', async () => {
    resetStore({
      materials: [material({ filename: 'week1.pdf' })],
      sessions: {
        'sess-1': session({
          turns: [
            userTurn('what is hashing?'),
            assistantTurn({
              results: [
                tierResult({ answer: 'Chaining.' }),
                tierResult({
                  tier: 'related',
                  course: 'cs2040',
                  answer: 'Open addressing probes.',
                  citations: [
                    evidence({ filename: 'week5.pdf', page_start: 2 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      },
    })
    localStorage.setItem('lattice.session.cs101.alice@example.com', 'sess-1')
    renderRoute('/courses/cs101')

    expect(
      await screen.findByText('Related course · CS2040'),
    ).toBeInTheDocument()
    expect(screen.getByText('Open addressing probes.')).toBeInTheDocument()
    const page = screen.getByRole('link', { name: 'week5.pdf, p. 2' })
    expect(page.getAttribute('href')).toBe(
      '/courses/cs2040?material=week5.pdf&page=2',
    )
    expect(page.getAttribute('target')).toBe('_blank')
    expect(page.getAttribute('rel')).toBe('noopener noreferrer')
    expect(
      screen.getByRole('link', { name: 'week5.pdf' }).getAttribute('target'),
    ).toBe('_blank')
    // The course's own reference still opens in place.
    expect(
      screen.getByRole('link', { name: 'week1.pdf' }).getAttribute('target'),
    ).toBeNull()
  })

  it('turns an Evidence block of chunk ids into Page badges', async () => {
    const sha = 'a'.repeat(64)
    withAnswer(
      [
        'Kinetic energy is \\(K = \\frac{1}{2} m v^2\\).',
        '',
        'Evidence:',
        `- chunk 1 of document ${sha} (data_id: d-1, chunk_id: c-1): "Page 5: Energy and motion This deck…"`,
        `- chunk 2 of document ${sha} (data_id: d-1, chunk_id: c-2)`,
      ].join('\n'),
      [],
    )

    const badge = await screen.findByRole('link', { name: 'week1.pdf, p. 5' })
    expect(badge.getAttribute('href')).toBe(
      '/courses/cs101?material=week1.pdf&page=5',
    )
    expect(screen.queryByText(/chunk_id|data_id|Evidence:/)).toBeNull()
    expect(document.body).not.toHaveTextContent(sha)
  })

  it('reads as one answer across Materials and Notes, with one list of references', async () => {
    resetStore({
      materials: [material({ filename: 'week1.pdf' })],
      notes: [note({ id: 'n1', body_md: '# My mnemonic\n\nviolet abacus' })],
      sessions: {
        'sess-1': session({
          turns: [
            userTurn('how are collisions resolved?'),
            assistantTurn({
              results: [
                tierResult({
                  answer: 'Chaining.',
                  citations: [
                    evidence({ filename: 'a'.repeat(64), page_start: 3 }),
                  ],
                }),
                tierResult({
                  tier: 'private',
                  answer: 'Your mnemonic is violet abacus.',
                  citations: [
                    evidence({ filename: 'n1.md', chunk_id: 'c-n1' }),
                  ],
                }),
              ],
            }),
          ],
        }),
      },
    })
    localStorage.setItem('lattice.session.cs101.alice@example.com', 'sess-1')
    renderRoute('/courses/cs101')

    expect(await screen.findByText('Chaining.')).toBeInTheDocument()
    expect(
      screen.getByText('Your mnemonic is violet abacus.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Course materials')).toBeNull()
    expect(screen.queryByText('Your notes')).toBeNull()
    expect(screen.getAllByText('Citations')).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'week1.pdf, p. 3' }),
    ).toBeInTheDocument()
    expect(screen.getByText('My mnemonic')).toBeInTheDocument()
  })
})

describe('the ask bar', () => {
  it('clears and locks the field while asking, then hands it back', async () => {
    resetStore({ materials: [material()] })
    answerNextAskWith(
      assistantTurn({ results: [tierResult({ answer: 'Buckets.' })] }),
      { after: 150 },
    )
    const user = userEvent.setup()
    renderRoute('/courses/cs101')

    const field = await screen.findByPlaceholderText(/Ask about CS101/)
    await user.type(field, 'what is a bucket?')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(field).toBeDisabled()
    expect(field).toHaveValue('')
    expect(screen.getByText('what is a bucket?')).toBeInTheDocument()
    expect(screen.getByText('Thinking…')).toBeInTheDocument()

    expect(await screen.findByText('Buckets.')).toBeInTheDocument()
    // The answer lands a beat before the mutation settles and the field unlocks.
    await waitFor(() => expect(field).toBeEnabled())
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
  })

  it('scrolls to the bottom when a question is sent, not when the answer lands', async () => {
    resetStore({ materials: [material()] })
    answerNextAskWith(
      assistantTurn({ results: [tierResult({ answer: 'Buckets.' })] }),
      { after: 150 },
    )
    const scrolls = () =>
      vi.mocked(HTMLElement.prototype.scrollTo).mock.calls.length
    const user = userEvent.setup()
    renderRoute('/courses/cs101')

    const field = await screen.findByPlaceholderText(/Ask about CS101/)
    const before = scrolls()
    await user.type(field, 'what is a bucket?')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    const onSend = scrolls()
    expect(onSend).toBeGreaterThan(before)

    expect(await screen.findByText('Buckets.')).toBeInTheDocument()
    await waitFor(() => expect(field).toBeEnabled())
    expect(scrolls()).toBe(onSend)
  })

  it('puts the question back when the ask fails', async () => {
    resetStore({ materials: [material()] })
    server.use(
      http.post('*/ask', () =>
        HttpResponse.json({ detail: 'search unavailable' }, { status: 502 }),
      ),
    )
    const user = userEvent.setup()
    renderRoute('/courses/cs101')

    const field = await screen.findByPlaceholderText(/Ask about CS101/)
    await user.type(field, 'what is a bucket?')
    await user.click(screen.getByRole('button', { name: 'Ask Lattice' }))

    expect(await screen.findByText(/search unavailable/)).toBeInTheDocument()
    expect(field).toBeEnabled()
    expect(field).toHaveValue('what is a bucket?')
  })
})
