//  @ts-check

import { defineConfig } from '@hey-api/openapi-ts'

// Types only. The transport in src/lib/api.ts stays hand-written (ADR 0005): it carries the
// `X-User` header that OAuth will replace and the flattening of FastAPI's `detail` arrays,
// both of which a generated SDK would bury. So no client, no SDK, no runtime dependency.
//
// The output is committed so `npm install && npm run build` works without Python. CI
// regenerates it and fails on a diff, which is what keeps it honest.
export default defineConfig({
  input: '../contracts/openapi.json',
  output: {
    path: 'src/lib/generated',
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/typescript'],
})
