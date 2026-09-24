import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  assistantTurn,
  evidence,
  material,
  session,
  tierResult,
  userTurn,
} from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

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

    expect(await screen.findByText('References')).toBeInTheDocument()
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
})
