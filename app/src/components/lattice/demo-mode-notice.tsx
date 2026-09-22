import { usesMockBackend } from '#/lib/api'

export function DemoModeNotice() {
  if (!usesMockBackend()) return null

  return (
    <p
      role="status"
      className="shrink-0 border-b border-border bg-feedback-developing px-5 py-3 text-sm text-feedback-developing-text"
    >
      Demo mode: answers are prewritten examples. Materials, Notes, and Sessions
      are temporary and reset when you reload.
    </p>
  )
}
