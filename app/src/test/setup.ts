import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'

import { resetStore } from './handlers'
import { server } from './server'

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
