import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Ask } from '#/components/ask'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course/ask/$sessionId')({
  component: Conversation,
})

function Conversation() {
  const { course, sessionId } = Route.useParams()
  const [user] = useUser()
  const navigate = useNavigate()
  const leave = () =>
    void navigate({
      to: '/courses/$course/ask',
      params: { course },
      replace: true,
    })

  return (
    <Ask
      key={`${course}:${user}:${sessionId}`}
      course={course}
      user={user}
      sessionId={sessionId}
      onSessionStarted={(next) =>
        void navigate({
          to: '/courses/$course/ask/$sessionId',
          params: { course, sessionId: next },
          replace: true,
        })
      }
      onLeaveSession={leave}
    />
  )
}
