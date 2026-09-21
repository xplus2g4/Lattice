/** A call the API refused; `message` is the server's `detail`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}
