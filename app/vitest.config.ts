//  @ts-check

import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

// Deliberately not `vite.config.ts` with a `test` block. That config loads nitro(),
// tanstackStart() and devtools(), which stand up the SSR and Nitro server pipeline; a
// jsdom unit run needs none of it and it is the part most likely to break under the
// runner. Only the React transform and the `#/` alias are shared.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
