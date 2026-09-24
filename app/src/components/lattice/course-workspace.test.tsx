import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KEEP_LOADED } from '#/lib/tabs'
import { material, note } from '#/test/fixtures'
import { resetStore, store } from '#/test/handlers'
import { renderRoute } from '#/test/render'

// jsdom can run neither pdf.js nor layout; what is under test is the tabs around the viewer.
vi.mock('react-pdf', () => ({
  Document: () => <div>rendered pdf</div>,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

const FILES = ['week1.pdf', 'week2.pdf', 'week3.pdf', 'memo.md']

function seed() {
  resetStore({ materials: FILES.map((filename) => material({ filename })) })
}

async function openFromSidebar(filename: string) {
  const sidebar = screen.getByText('MATERIALS').closest('section')
  if (!sidebar) throw new Error('no Materials panel')
  await userEvent.click(await within(sidebar).findByText(filename))
  await screen.findByRole('tab', { name: filename })
}

/** The workspace's tabs only: Ask has tabs of its own. */
function openTabs() {
  const bar = screen.queryByRole('tablist', { name: 'Open tabs' })
  return bar
    ? within(bar)
        .queryAllByRole('tab')
        .map((t) => t.textContent)
    : []
}

describe('the workspace tabs', () => {
  it('opens a Material as a tab without rebuilding the sidebar or Ask', async () => {
    seed()
    renderRoute('/courses/cs101')
    const ask = await screen.findByPlaceholderText(/Ask about/)
    const sidebar = screen.getByText('MATERIALS').closest('aside')

    await openFromSidebar('week1.pdf')

    expect(screen.getByPlaceholderText(/Ask about/)).toBe(ask)
    expect(screen.getByText('MATERIALS').closest('aside')).toBe(sidebar)
  })

  it('renders a Markdown Material in a tab beside the sidebar', async () => {
    seed()
    const { router } = renderRoute('/courses/cs101')
    await screen.findByText('MATERIALS')

    await openFromSidebar('memo.md')

    expect(
      await screen.findByRole('heading', { name: 'Sample memo' }),
    ).toBeInTheDocument()
    expect(screen.getByText('MATERIALS')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ material: 'memo.md' })
  })

  it(`keeps only ${KEEP_LOADED} tabs loaded`, async () => {
    seed()
    renderRoute('/courses/cs101')
    await screen.findByText('MATERIALS')

    for (const filename of FILES) await openFromSidebar(filename)

    expect(openTabs()).toEqual(FILES)
    // A loaded tab's panel is in the page. The first opened was viewed longest ago, so
    // it is the one unloaded.
    const loaded = FILES.filter((name) => {
      const tab = screen.getByRole('tab', { name })
      return document.getElementById(tab.getAttribute('aria-controls') ?? '')
    })
    expect(loaded).toHaveLength(KEEP_LOADED)
    expect(loaded).toEqual(['week2.pdf', 'week3.pdf', 'memo.md'])
  })

  it('shows the neighbour of a closed tab and moves the URL to it', async () => {
    seed()
    const { router } = renderRoute('/courses/cs101')
    await screen.findByText('MATERIALS')
    await openFromSidebar('week1.pdf')
    await openFromSidebar('week2.pdf')

    await userEvent.click(
      screen.getByRole('button', { name: 'Close week2.pdf' }),
    )

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ material: 'week1.pdf' }),
    )
    expect(openTabs()).toEqual(['week1.pdf'])
  })

  it('brings back the tabs left open when the course is opened again', async () => {
    seed()
    const { router } = renderRoute('/courses/cs101')
    await screen.findByText('MATERIALS')
    await openFromSidebar('week1.pdf')
    await openFromSidebar('week2.pdf')

    await router.navigate({
      to: '/courses/$course',
      params: { course: 'cs101' },
      search: {},
    })

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ material: 'week2.pdf' }),
    )
    expect(openTabs()).toEqual(['week1.pdf', 'week2.pdf'])
  })

  it('closes the tab of a Material that no longer exists', async () => {
    seed()
    const { router } = renderRoute('/courses/cs101?material=gone.pdf')
    await screen.findByText('MATERIALS')

    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(openTabs()).toEqual([])
    expect(
      screen.getByText(/Open a Material or Note from the sidebar/),
    ).toBeVisible()
  })
})

describe('Notes in tabs', () => {
  const TYPED = note({
    id: '3f1c2b4a-0000-4000-8000-000000000001',
    body_md: '# Hash tables\n\nare **week 3**',
  })

  async function openNote(text: string) {
    const panel = (await screen.findByText('NOTES')).closest('section')
    if (!panel) throw new Error('no Notes panel')
    await userEvent.click(await within(panel).findByText(text))
  }

  it('writes a new Note in an Untitled tab and names it on its first save', async () => {
    resetStore()
    const { router } = renderRoute('/courses/cs101')
    await userEvent.click(await screen.findByRole('button', { name: 'Write' }))

    await screen.findByRole('tab', { name: 'Untitled' })
    await userEvent.type(screen.getByLabelText('Note body'), 'Graph walks')
    expect(screen.getByRole('tab', { name: /unsaved.*Untitled/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('tab', { name: 'Graph walks' }),
    ).toBeInTheDocument()
    expect(openTabs()).toEqual(['Graph walks'])
    const saved = store.notes.find((n) => n.body_md === 'Graph walks')
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ note: saved?.id }),
    )
  })

  it('renders a Note until it is double-clicked, and again on Escape', async () => {
    resetStore({ notes: [TYPED] })
    renderRoute('/courses/cs101')
    await openNote(TYPED.id)

    const heading = await screen.findByRole('heading', { name: 'Hash tables' })
    expect(screen.getByText('week 3').tagName).toBe('STRONG')
    expect(screen.queryByLabelText('Note body')).not.toBeInTheDocument()

    await userEvent.dblClick(heading)
    const body = screen.getByLabelText('Note body')
    expect(body).toHaveValue(TYPED.body_md)
    expect(body).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(
      await screen.findByRole('heading', { name: 'Hash tables' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Note body')).not.toBeInTheDocument()
  })

  it('asks before closing a Note with unsaved edits', async () => {
    resetStore({ notes: [TYPED] })
    renderRoute('/courses/cs101')
    await openNote(TYPED.id)
    await userEvent.dblClick(
      await screen.findByRole('heading', { name: 'Hash tables' }),
    )
    const body = screen.getByLabelText('Note body')
    expect(body).toHaveValue(TYPED.body_md)
    await userEvent.type(body, ', probably')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)

    await userEvent.click(
      screen.getByRole('button', { name: 'Close Hash tables' }),
    )
    expect(confirm).toHaveBeenCalledOnce()
    expect(openTabs()).toHaveLength(1)

    confirm.mockReturnValueOnce(true)
    await userEvent.click(
      screen.getByRole('button', { name: 'Close Hash tables' }),
    )
    await waitFor(() => expect(openTabs()).toEqual([]))
  })

  it('opens a PDF Note in the reader', async () => {
    resetStore({
      notes: [note({ id: 'pdf-1', filename: 'summary.pdf', body_md: '' })],
    })
    renderRoute('/courses/cs101')

    await openNote('summary.pdf')

    expect(
      await screen.findByRole('tab', { name: 'summary.pdf' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('rendered pdf')).toBeInTheDocument()
  })
})

describe('splitting the tabs', () => {
  /** Each group's tabs, left then right. */
  function groups() {
    return screen.getAllByRole('tablist', { name: 'Open tabs' }).map((bar) =>
      within(bar)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    )
  }

  it('moves a tab into a split from the keyboard, and back', async () => {
    seed()
    const { router } = renderRoute('/courses/cs101')
    await screen.findByText('MATERIALS')
    await openFromSidebar('week1.pdf')
    await openFromSidebar('week2.pdf')

    screen.getByRole('tab', { name: 'week2.pdf' }).focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}')

    await waitFor(() =>
      expect(groups()).toEqual([['week1.pdf'], ['week2.pdf']]),
    )
    expect(router.state.location.search).toEqual({ material: 'week2.pdf' })

    screen.getByRole('tab', { name: 'week2.pdf' }).focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}')

    await waitFor(() => expect(groups()).toEqual([['week1.pdf', 'week2.pdf']]))
  })
})
