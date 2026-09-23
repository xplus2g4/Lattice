import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

describe('uploading Materials', () => {
  it('lists one Material per selected file', async () => {
    resetStore()
    renderRoute('/courses/cs101')
    const input = (await screen.findByText('MATERIALS'))
      .closest('section')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('the Materials panel has no file input')
    expect(input.multiple).toBe(true)

    fireEvent.change(input, {
      target: {
        files: [new File(['a'], 'week1.pptx'), new File(['b'], 'week2.pdf')],
      },
    })

    expect(await screen.findByText('week1.pptx')).toBeInTheDocument()
    expect(await screen.findByText('week2.pdf')).toBeInTheDocument()
  })
})
