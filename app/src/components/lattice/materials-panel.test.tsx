import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_FILES } from '#/lib/api'
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

  it('refuses a selection over the limit before uploading', async () => {
    resetStore()
    renderRoute('/courses/cs101')
    const input = (await screen.findByText('MATERIALS'))
      .closest('section')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('the Materials panel has no file input')

    fireEvent.change(input, {
      target: {
        files: Array.from(
          { length: MAX_UPLOAD_FILES + 1 },
          (_, i) => new File(['a'], `extra-${i}.pdf`),
        ),
      },
    })

    expect(
      await screen.findByText(
        `Select at most ${MAX_UPLOAD_FILES} files at a time.`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('extra-0.pdf')).not.toBeInTheDocument()
  })
})
