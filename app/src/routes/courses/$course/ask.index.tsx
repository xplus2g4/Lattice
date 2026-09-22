import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { AskPanel } from '#/components/lattice/ask-panel'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$course/ask/')({
  component: AskPage,
})
function AskPage() {
  const { course } = Route.useParams()
  const [user] = useUser()
  const navigate = useNavigate()
  const select = useCallback(
    (sessionId: string | null) => {
      if (sessionId)
        void navigate({
          to: '/courses/$course/ask/$sessionId',
          params: { course, sessionId },
          replace: true,
        })
    },
    [course, navigate],
  )
  return (
    <main className="flex h-full min-h-0 flex-col">
      <AskPanel
        key={`${course}:${user}`}
        course={course}
        user={user}
        onSessionChange={select}
      />
    </main>
  )
}
