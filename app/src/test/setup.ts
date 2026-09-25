import '@testing-library/jest-dom/vitest'
import { File } from 'node:buffer'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { resetStore } from './handlers'
import { server } from './server'

// Uploads cross two runtimes here: jsdom supplies `File` and `FormData`, but `fetch` and
// `Request` are Node's, and Node's multipart serialiser keeps a filename only for its own
// `File` class; anything else becomes an anonymous "blob". jsdom's `FormData` in turn
// refuses Node's `File`. So both globals come from Node, and an upload reaches the mock
// handlers with the name the test gave it. Node keeps its `FormData` class private once
// the global is shadowed; a parsed Response is the one place it is still handed out.
const NodeFormData = (await new Response(new URLSearchParams()).formData())
  .constructor as typeof FormData
Object.assign(globalThis, { File, FormData: NodeFormData })

// jsdom has no layout, so no ResizeObserver; the PDF reader and the split's panels
// both observe their size. Nothing is ever reported, which suits a layout-free test.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Nor media queries: every query matches, so tests see the wide layout.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
})

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
})
Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
})

// The root shell mounts the devtools overlay, which expects the dev server's bridge and
// throws without it. It is a development affordance, not behaviour, so it is stubbed
// here rather than guarded in `__root.tsx`.
vi.mock('@tanstack/react-devtools', () => ({
  TanStackDevtools: () => null,
}))

// The resizable columns hit-test every pointerdown against the divider's rect; jsdom has
// no layout, so every rect is 0×0 at the origin and every click lands on the divider,
// which takes focus and prevents the default. Plain wrappers keep what is under test.
vi.mock('react-resizable-panels', async () => {
  const { createElement } = await import('react')
  const Wrap = ({
    children,
    className,
  }: {
    children?: unknown
    className?: string
  }) => createElement('div', { className }, children as never)
  return { Group: Wrap, Panel: Wrap, Separator: () => null }
})

// Auth is a cookie session plus a web-minted Bearer token in the real app; in a jsdom
// unit run there is no Nitro server behind the server functions, so the session is
// stubbed to one fixed user and the API mocks see Bearer test-token instead.
vi.mock('#/lib/auth', () => ({
  getSessionUser: async () => ({ sub: 'g|alice', email: 'alice@example.com' }),
  getApiToken: async () => ({
    token: 'test-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }),
  apiToken: async () => 'test-token',
  clearApiTokenCache: () => {},
  redeemInvite: async () => ({ ok: true }),
}))

// `error`, not `warn`: a request nobody mocked means the test is exercising something it
// did not intend, which should fail rather than pass quietly against a dead fetch.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  server.resetHandlers()
  resetStore()
  cleanup()
  localStorage.clear()
})

afterAll(() => server.close())
