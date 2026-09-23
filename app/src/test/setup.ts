import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { resetStore } from './handlers'
import { server } from './server'

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
