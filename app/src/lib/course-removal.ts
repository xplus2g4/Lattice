import {
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'
import { deleteCourse, usesMockBackend } from './api'
import { useLibrary } from './library'
import type { CourseSummary } from './api'

const KEY = ['remove-course']
interface Removal {
  user: string
  course: string
  demo: boolean
}

export function useCourseRemovalState(user: string, course: string) {
  // Observe the shared cache so navigating away does not lose progress or errors.
  const removals = useMutationState({
    filters: { mutationKey: KEY },
    select: (mutation) => ({
      target: mutation.state.variables as Removal | undefined,
      status: mutation.state.status,
      error: mutation.state.error,
    }),
  })
  const latest = removals
    .filter(
      (r) =>
        r.target?.user === user &&
        r.target.course === course &&
        r.target.demo === usesMockBackend(),
    )
    .at(-1)
  return {
    isPending: latest?.status === 'pending',
    error: latest?.status === 'error' ? latest.error : null,
  }
}

export function useCourseRemoval() {
  const queryClient = useQueryClient()
  const { removeCourse } = useLibrary()
  return useMutation({
    mutationKey: KEY,
    retry: false,
    mutationFn: ({ user, course }: Removal) => deleteCourse(user, course),
    // Mutation callbacks run even after the initiating card has unmounted.
    // Use request variables so changing the selected user cannot retarget cleanup.
    onSuccess: (_, { user, course }) => {
      removeCourse(course, user)
      queryClient.removeQueries({
        predicate: (q) => q.queryKey.includes(course),
      })
      queryClient.setQueryData<Array<CourseSummary>>(
        ['courses', user],
        (previous) => previous?.filter((c) => c.code !== course),
      )
      void queryClient.invalidateQueries({ queryKey: ['courses', user] })
    },
  })
}
