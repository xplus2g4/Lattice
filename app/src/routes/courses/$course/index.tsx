import { createFileRoute, redirect } from '@tanstack/react-router'

// Asking is the point of a course page, so the bare course URL opens there.
export const Route = createFileRoute('/courses/$course/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/courses/$course/ask', params })
  },
})
