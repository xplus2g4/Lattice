import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { getReadingPosition, listTopics } from '#/lib/api'
import type { Enrolment } from '#/lib/api'
import type { MaterialOut } from '#/lib/generated'

export function QuizSetup({
  materials,
  user,
  course,
  loading,
  error,
  retry,
  initialMaterial,
}: Enrolment & {
  materials: Array<MaterialOut>
  loading: boolean
  error: Error | null
  retry: () => void
  initialMaterial?: string
}) {
  const [material, setMaterial] = useState(
    () =>
      materials.find(
        (m) => m.filename === initialMaterial && m.status === 'ready',
      )?.id ?? '',
  )
  const [scope, setScope] = useState<'current' | 'pages' | 'topics' | 'whole'>(
    'whole',
  )
  const [topics, setTopics] = useState<Array<string>>([])
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState('1')
  const availableTopics = useQuery({
    queryKey: ['quiz-topics', course, user, material],
    queryFn: () => listTopics(user, material),
    enabled: !!material,
  })
  const position = useQuery({
    queryKey: ['quiz-reading-position', course, user, material],
    queryFn: () => getReadingPosition(user, material),
    enabled: !!material && scope === 'current',
  })
  const selected = materials.find((m) => m.id === material)
  const rangeValid =
    Number.isInteger(Number(start)) &&
    Number.isInteger(Number(end)) &&
    Number(start) >= 1 &&
    Number(end) >= Number(start) &&
    (!selected?.page_count || Number(end) <= selected.page_count)
  return (
    <section aria-labelledby="quiz-setup-title" className="space-y-5">
      <h2 id="quiz-setup-title" className="sr-only">
        What would you like to practise?
      </h2>
      <div className="space-y-5 rounded-2xl border bg-card p-5">
        {error ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>Couldn’t load Materials: {error.message}</p>
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <label className="block space-y-2 text-sm font-medium">
              <span className="text-xs uppercase text-muted-foreground">
                Material
              </span>
              <select
                aria-label="Material"
                className="min-h-12 w-full rounded-xl border-0 bg-background px-3 font-semibold"
                value={material}
                disabled={loading}
                onChange={(e) => {
                  setMaterial(e.target.value)
                  setTopics([])
                  setStart('1')
                  setEnd('1')
                }}
              >
                <option value="">
                  {loading ? 'Loading Materials…' : 'Choose a Material'}
                </option>
                {materials.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={m.status !== 'ready'}
                  >
                    {m.filename}
                    {m.status !== 'ready' ? ' (not ready)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!loading && materials.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add course Materials to get ready for your first Quiz.
              </p>
            )}
            <fieldset disabled={!material} className="space-y-3">
              <legend className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Scope
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['current', 'Current Page'],
                    ['pages', 'Selected Pages'],
                    ['topics', 'Topics'],
                    ['whole', 'Whole Material'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`relative flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-xs font-medium ${scope === value ? 'border-primary bg-secondary text-secondary-foreground' : 'text-muted-foreground'} ${!material ? 'opacity-50' : ''}`}
                  >
                    <input
                      className="sr-only peer"
                      type="radio"
                      name="quiz-scope"
                      checked={scope === value}
                      onChange={() => {
                        setScope(value)
                        if (value !== 'topics') setTopics([])
                      }}
                    />
                    <span className="peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
              {material && scope === 'current' && (
                <p className="text-sm">
                  {position.isPending
                    ? 'Loading your reading position…'
                    : position.isError
                      ? 'Couldn’t load your reading position. Choose a Page range instead.'
                      : `Page ${position.data}`}
                </p>
              )}
              {scope === 'pages' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-3">
                    <label className="text-sm">
                      From Page
                      <input
                        aria-label="From Page"
                        type="number"
                        min={1}
                        max={selected?.page_count ?? undefined}
                        className="ml-2 w-20 rounded-lg border bg-background p-2"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      To Page
                      <input
                        aria-label="To Page"
                        type="number"
                        min={Number(start) || 1}
                        max={selected?.page_count ?? undefined}
                        className="ml-2 w-20 rounded-lg border bg-background p-2"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                  </div>
                  {!rangeValid && (
                    <p role="alert" className="text-sm text-destructive">
                      Choose a valid Page range within this Material.
                    </p>
                  )}
                </div>
              )}
            </fieldset>
            {material && (
              <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Topics
                </legend>
                {availableTopics.isPending ? (
                  <p role="status" className="text-sm">
                    Loading Topics…
                  </p>
                ) : availableTopics.isError ? (
                  <div role="alert">
                    <p className="text-sm">Couldn’t load Topics.</p>
                    <Button
                      variant="outline"
                      onClick={() => void availableTopics.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableTopics.data.map((topic) => (
                      <label
                        key={topic.id}
                        className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-xs ${topics.includes(topic.id) ? 'bg-secondary text-secondary-foreground' : 'bg-background text-muted-foreground'}`}
                      >
                        <input
                          type="checkbox"
                          checked={topics.includes(topic.id)}
                          onChange={(e) => {
                            setScope('topics')
                            setTopics((prev) =>
                              e.target.checked
                                ? [...prev, topic.id]
                                : prev.filter((id) => id !== topic.id),
                            )
                          }}
                        />
                        <span>
                          {topic.label}
                          <span className="sr-only">
                            {' '}
                            · Pages {topic.page_start}–{topic.page_end}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {!availableTopics.isPending &&
                  !availableTopics.isError &&
                  availableTopics.data.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No Topics available yet. You can select Pages or the whole
                      Material.
                    </p>
                  )}
              </fieldset>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
        <div className="space-y-1">
          <h3 className="quiz-heading text-xl">Practice summary</h3>
          <p className="text-sm text-muted-foreground">
            {scope === 'topics'
              ? `${topics.length} Topics selected`
              : scope === 'pages'
                ? `Pages ${start}–${end}`
                : scope === 'current'
                  ? 'Your current Page'
                  : 'All Topics in this Material'}
          </p>
        </div>
        <Button disabled aria-describedby="quiz-generation-status">
          Start Grill me
        </Button>
      </div>
      <p id="quiz-generation-status" className="text-sm text-muted-foreground">
        New Quiz generation is coming soon. You can answer and review Quizzes
        that are already saved.
      </p>
    </section>
  )
}
