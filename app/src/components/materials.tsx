import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { listMaterials, uploadMaterial } from '#/lib/api'
import type { Material } from '#/lib/api'
import {
  ErrorLine,
  StatusBadge,
  buttonClass,
  pollWhilePending,
} from '#/components/common'
import type { Scope } from '#/components/common'

export function Materials({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const key = ['materials', course, user]
  const materials = useQuery({
    queryKey: key,
    queryFn: () => listMaterials(user, course),
    refetchInterval: (q) => pollWhilePending<Material>(q.state.data),
  })
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: (f: File) => uploadMaterial(user, course, f),
    onSuccess: () => {
      setFile(null)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Materials</h2>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (file) upload.mutate(file)
        }}
      >
        <input
          className="text-sm"
          type="file"
          accept=".pdf,.pptx,.md,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          className={buttonClass}
          type="submit"
          disabled={!file || upload.isPending}
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      <ErrorLine error={upload.error} />
      <ErrorLine error={materials.error} />
      <ul className="divide-y divide-gray-200">
        {materials.data?.map((m) => (
          <li
            key={m.filename}
            className="flex flex-wrap items-center gap-2 py-1"
          >
            <span className="text-sm">{m.filename}</span>
            <StatusBadge status={m.status} />
            {m.status === 'failed' && m.error && (
              <span className="text-xs text-red-700">{m.error}</span>
            )}
          </li>
        ))}
        {materials.data?.length === 0 && (
          <li className="text-sm text-gray-500">No materials yet.</li>
        )}
      </ul>
    </section>
  )
}
