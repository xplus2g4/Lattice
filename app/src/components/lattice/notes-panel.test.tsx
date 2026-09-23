import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

describe('uploading PDF Notes', () => {
  it('lists one Note per selected file', async () => {
    resetStore()
    renderRoute('/courses/cs101')
    const input = (await screen.findByText('NOTES'))
      .closest('section')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('the Notes panel has no file input')
    expect(input.multiple).toBe(true)

    fireEvent.change(input, {
      target: {
        files: [
          new File(['a'], 'summary-1.pdf'),
          new File(['b'], 'summary-2.pdf'),
        ],
      },
    })

    expect(await screen.findByText('summary-1.pdf')).toBeInTheDocument()
    expect(await screen.findByText('summary-2.pdf')).toBeInTheDocument()
  })
})
