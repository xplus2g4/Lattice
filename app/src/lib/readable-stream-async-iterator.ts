/**
 * Async iteration over a ReadableStream, for browsers that lack it.
 *
 * pdf.js reads its text-content stream with `for await (… of readableStream)`, so on a
 * browser without `ReadableStream.prototype[Symbol.asyncIterator]` every text layer a
 * Material's pages render throws. Install this before rendering a PDF.
 */
export function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return
  const proto: object = ReadableStream.prototype
  if (Symbol.asyncIterator in proto) return
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function <T>(this: ReadableStream<T>) {
      const reader = this.getReader()
      const iterator: AsyncIterableIterator<T> = {
        async next() {
          const result = await reader.read()
          if (result.done) {
            reader.releaseLock()
            return { done: true, value: undefined }
          }
          return { done: false, value: result.value }
        },
        async return(value?: unknown) {
          await reader.cancel(value)
          reader.releaseLock()
          return { done: true, value: value as T }
        },
        [Symbol.asyncIterator]() {
          return iterator
        },
      }
      return iterator
    },
  })
}
