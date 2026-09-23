import { afterEach, expect, test } from 'vitest'

import { installReadableStreamAsyncIterator } from './readable-stream-async-iterator'

// Exercises the real pdf.js call a Material's text layer makes, on a ReadableStream
// stripped of async iteration the way Safari < 18.4 and Firefox ship it.

const original = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  Symbol.asyncIterator,
)

function stripAsyncIteration() {
  Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator)
}

afterEach(() => {
  stripAsyncIteration()
  if (original)
    Object.defineProperty(
      ReadableStream.prototype,
      Symbol.asyncIterator,
      original,
    )
})

/** Smallest single-page PDF carrying selectable text. */
function pdfBytes(): Uint8Array {
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    '5 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 20 100 Td (Lattice) Tj ET\nendstream endobj\n',
  ]
  const offsets: Array<number> = []
  let pdf = '%PDF-1.4\n'
  for (const object of objects) {
    offsets.push(pdf.length)
    pdf += object
  }
  const startxref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Uint8Array.from(pdf, (c) => c.charCodeAt(0))
}

async function renderText(): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: pdfBytes(),
    useWorkerFetch: false,
  }).promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((item) => ('str' in item ? item.str : '')).join('')
}

test('a stripped ReadableStream breaks the pdf.js text layer', async () => {
  stripAsyncIteration()
  await expect(renderText()).rejects.toThrow(/not async iterable/)
})

test('installing async iteration lets the pdf.js text layer read', async () => {
  stripAsyncIteration()
  installReadableStreamAsyncIterator()
  await expect(renderText()).resolves.toBe('Lattice')
})
