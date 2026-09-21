import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Ask } from '#/components/ask'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course/ask/')({
  component: NewConversation,
})

function NewConversation() {
  const { course } = Route.useParams()
  const [user] = useUser()
  const navigate = useNavigate()

  return (
    <Ask
      course={course}
      user={user}
      sessionId={null}
      onSessionStarted={(sessionId) =>
        void navigate({
          to: '/courses/$course/ask/$sessionId',
          params: { course, sessionId },
          replace: true,
        })
      }
    />
  )
}
