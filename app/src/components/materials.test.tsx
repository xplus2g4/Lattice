import { HttpResponse, http } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { material } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { server } from '#/test/server'
import { renderRoute } from '#/test/render'

function show() {
  return renderRoute('/courses/cs101/materials')
}

describe('the materials list', () => {
  it('registers a locally saved course before retrying its first upload', async () => {
    let exists = false
    server.use(
      http.post('*/materials.upload', () =>
        exists
          ? undefined
          : HttpResponse.json({ detail: 'no such course' }, { status: 404 }),
      ),
      http.post('*/enrolments.join', () =>
        HttpResponse.json(exists ? {} : { detail: 'no such course' }, {
          status: exists ? 200 : 404,
        }),
      ),
      http.post('*/courses.create', () => {
        exists = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    const { container } = renderRoute('/courses/cs2100/materials')
    await screen.findByRole('button', { name: 'Upload' })
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['CS2100 Material'], 'week1.md', { type: 'text/markdown' }),
    )
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByText('queued')).toBeInTheDocument()
    expect(exists).toBe(true)
  })
  it('says so when the course has no materials', async () => {
    show()

    expect(await screen.findByText(/No materials yet/)).toBeInTheDocument()
  })

  it('shows each material with its ingest status', async () => {
    resetStore({
      materials: [
        material({ filename: 'week1.pdf', status: 'ready' }),
        material({ filename: 'week2.pptx', status: 'cognifying' }),
      ],
    })

    show()

    expect(await screen.findByText('week1.pdf')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.getByText('week2.pptx')).toBeInTheDocument()
    expect(screen.getByText('cognifying')).toBeInTheDocument()
  })

  it('explains why a material failed', async () => {
    resetStore({
      materials: [
        material({
          status: 'failed',
          error: 'LanceDB failed to persist temp file',
        }),
      ],
    })

    show()

    expect(
      await screen.findByText('LanceDB failed to persist temp file'),
    ).toBeInTheDocument()
  })

  // The uploaded filename is not asserted: jsdom builds the FormData and undici
  // serialises it, and the name does not survive that handoff in either direction. That
  // is an artifact of the test environment, not of the app, so this checks the part that
  // is real -- the upload reaches the API and the list picks the new material up.
  it('adds the uploaded material to the list, still queued', async () => {
    const user = userEvent.setup()
    const { container } = show()
    await screen.findByText(/No materials yet/)

    await screen.findByRole('button', { name: 'Upload' })
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['# week 3'], 'week3.md', { type: 'text/markdown' }),
    )
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText('queued')).toBeInTheDocument()
    expect(screen.queryByText(/No materials yet/)).not.toBeInTheDocument()
  })

  it('reports an upload the API rejected', async () => {
    server.use(
      http.post('*/materials.upload', () =>
        HttpResponse.json(
          { detail: 'material exceeds the 20 MB ceiling' },
          { status: 413 },
        ),
      ),
    )
    const user = userEvent.setup()
    const { container } = show()
    await screen.findByText(/No materials yet/)

    // The filename has to match the input's `accept` list, or userEvent drops it the way
    // a browser would and nothing is ever submitted.
    await screen.findByRole('button', { name: 'Upload' })
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'huge.pdf', { type: 'application/pdf' }),
    )
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(
      await screen.findByText('material exceeds the 20 MB ceiling'),
    ).toBeInTheDocument()
  })
})

// Cognify is slow, so the list polls itself; these two pin the cost of that. They wait on
// real time because the interval is a real 2s, which is why there are only two of them.
describe('while a material is still being cognified', () => {
  it('picks up the status change without a reload', async () => {
    resetStore({ materials: [material({ status: 'cognifying' })] })
    show()
    await screen.findByText('cognifying')

    resetStore({ materials: [material({ status: 'ready' })] })

    expect(
      await screen.findByText('ready', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
  }, 10000)

  it('stops asking once everything is ready', async () => {
    let requests = 0
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.includes('/materials'))
        requests += 1
    })
    resetStore({ materials: [material({ status: 'ready' })] })

    show()
    await screen.findByText('ready')
    await new Promise((r) => setTimeout(r, 3000))

    await waitFor(() => expect(requests).toBe(1))
  }, 10000)
})
