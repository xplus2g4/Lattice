import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { useRef } from 'react'

import { Button } from '#/components/ui/button'
import {
  listMaterials,
  pollWhilePending,
  uploadEach,
  uploadMaterial,
} from '#/lib/api'
import { StatusBadge } from './status-badge'

import type { Enrolment } from '#/lib/api'

export function MaterialsPanel({ course, user }: Enrolment) {
  const queryClient = useQueryClient()
  const key = ['materials', course, user]
  const materials = useQuery({
    queryKey: key,
    queryFn: () => listMaterials(user, course),
    refetchInterval: (q) => pollWhilePending(q.state.data),
  })
  const inputRef = useRef<HTMLInputElement>(null)
  // Every selected file is uploaded at once; a failure is reported per file.
  const upload = useMutation({
    mutationFn: (files: Array<File>) =>
      uploadEach(files, (f) => uploadMaterial(user, course, f)),
    onSuccess: (results) => {
      void queryClient.invalidateQueries({ queryKey: key })
      // An upload replaces the bytes under an existing filename; drop each cached blob.
      for (const r of results) {
        void queryClient.invalidateQueries({
          queryKey: ['material-file', course, r.file.name, user],
        })
      }
    },
  })

  return (
    <section>
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <p className="text-lattice-meta font-semibold tracking-[0.14em] text-muted-foreground">
          MATERIALS
        </p>
        <Button
          variant="ghost"
          size="xs"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.md,.txt"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length)
              upload.mutate(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>
      {upload.error && (
        <p className="px-4 pb-1 text-xs text-destructive">
          {upload.error.message}
        </p>
      )}
      {upload.data
        ?.filter((r) => r.error)
        .map((r) => (
          <p key={r.file.name} className="px-4 pb-1 text-xs text-destructive">
            {r.file.name}: {r.error}
          </p>
        ))}
      {materials.error && (
        <p className="px-4 pb-1 text-xs text-destructive">
          {materials.error.message}
        </p>
      )}
      <ul className="space-y-0.5 px-2 pb-2">
        {materials.data?.map((m) => {
          const row = (
            <>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {m.filename}
                </span>
                <StatusBadge status={m.status} />
              </span>
              {m.status === 'failed' && m.error && (
                <span className="mt-0.5 block truncate text-xs text-destructive">
                  {m.error}
                </span>
              )}
            </>
          )
          const className =
            'block rounded-lg px-2 py-1.5 transition-colors hover:bg-accent'
          return (
            <li key={m.filename}>
              {m.filename.toLowerCase().endsWith('.pdf') ? (
                <Link
                  to="/courses/$course"
                  params={{ course: course }}
                  search={{ material: m.filename }}
                  className={className}
                >
                  {row}
                </Link>
              ) : (
                <Link
                  to="/courses/$course/materials/$filename"
                  params={{ course: course, filename: m.filename }}
                  className={className}
                >
                  {row}
                </Link>
              )}
            </li>
          )
        })}
        {materials.data?.length === 0 && (
          <li className="px-2 py-1.5 text-sm leading-6 text-muted-foreground">
            No materials yet — upload slides or a memo.
          </li>
        )}
      </ul>
    </section>
  )
}
