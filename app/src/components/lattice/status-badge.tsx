import { Badge } from '@/components/ui/badge'

import type { IngestStatus } from '#/lib/api'

const statusStyle: Record<IngestStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  cognifying: 'bg-feedback-developing text-feedback-developing-text',
  ready: 'bg-feedback-strong text-feedback-strong-text',
  failed: 'bg-destructive/15 text-destructive',
}

export function StatusBadge({ status }: { status: IngestStatus }) {
  return (
    <Badge variant="outline" className={`border-0 ${statusStyle[status]}`}>
      {status}
    </Badge>
  )
}
