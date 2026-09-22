import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { AskPanel } from '#/components/lattice/ask-panel'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$course/ask/$sessionId')({
  component: AskPage,
})
function AskPage() {
  const { course, sessionId } = Route.useParams()
  const [user] = useUser()
  const navigate = useNavigate()
  const select = useCallback(
    (next: string | null) => {
      if (next)
        void navigate({
          to: '/courses/$course/ask/$sessionId',
          params: { course, sessionId: next },
          replace: true,
        })
      else
        void navigate({
          to: '/courses/$course/ask',
          params: { course },
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
        sessionId={sessionId}
        onSessionChange={select}
      />
    </main>
  )
}
