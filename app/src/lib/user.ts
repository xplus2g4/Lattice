import { useQuery } from '@tanstack/react-query'

import { getSessionUser } from './auth'

export { useStored } from './storage'

/** The signed-in user's email, from the session. '' until the query resolves; there is
 * no setter now that identity is server-owned rather than a localStorage dev header. */
export function useUser(): string {
  const { data } = useQuery({
    queryKey: ['session-user'],
    queryFn: () => getSessionUser(),
    staleTime: 60_000,
  })
  return data?.email ?? ''
}
