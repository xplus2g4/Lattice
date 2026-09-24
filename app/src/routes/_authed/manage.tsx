import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import {
  ApiError,
  createInvite,
  getMe,
  listInvites,
  listUsers,
} from '#/lib/api'

import type { InviteSummary } from '#/lib/api'

export const Route = createFileRoute('/_authed/manage')({ component: Manage })

type Role = 'student' | 'instructor'
type InviteStatus = 'pending' | 'used' | 'expired'

function inviteStatus(invite: InviteSummary): InviteStatus {
  if (invite.used_at) return 'used'
  return new Date(invite.expires_at) > new Date() ? 'pending' : 'expired'
}

const STATUS_STYLE: Record<InviteStatus, string> = {
  pending: 'bg-feedback-developing text-feedback-developing-text',
  used: 'bg-feedback-strong text-feedback-strong-text',
  expired: 'bg-muted text-muted-foreground',
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

function Manage() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    retry: false,
  })

  if (me.isPending) {
    return (
      <main className="flex-1 px-5 py-10 sm:px-10 sm:py-14">
        <div className="mx-auto max-w-[1200px] space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </main>
    )
  }

  if (!['instructor', 'admin'].includes(me.data?.user.role ?? '')) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-3 py-8 text-center">
            <h1 className="text-lattice-heading font-semibold tracking-tight">
              Instructors only
            </h1>
            <p className="text-sm text-muted-foreground">
              This page is for instructors managing who can join.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex-1 px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-[1200px] space-y-10">
        <header className="border-b-2 border-foreground pb-8">
          <Link
            to="/"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ← Back home
          </Link>
          <p className="fieldnotes-kicker mt-6 text-primary">LATTICE</p>
          <h1 className="fieldnotes-display fieldnotes-reveal mt-3">
            Invite people
          </h1>
          <p className="mt-3 max-w-2xl text-lattice-prompt text-muted-foreground">
            Sign-up is invite-only. Each link works once and expires after the
            period you choose.
          </p>
        </header>

        <CreateInvite />
        <InvitesTable />
        <PeopleTable />
      </div>
    </main>
  )
}

function CreateInvite() {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>('student')
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const invite = useMutation({
    mutationFn: () => createInvite(role, expiresInDays),
    onSuccess: (data) => {
      setLink(`${window.location.origin}/invite/${data.token}`)
      setCopied(false)
      void queryClient.invalidateQueries({ queryKey: ['invites'] })
    },
  })

  const copy = () => {
    void navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-11 rounded-sm border border-input bg-card px-3 text-base sm:text-sm"
          aria-label="Invite role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="student">student</option>
          <option value="instructor">instructor</option>
        </select>
        <select
          className="h-11 rounded-sm border border-input bg-card px-3 text-base sm:text-sm"
          aria-label="Invite expiry"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
        >
          <option value={1}>expires in 1 day</option>
          <option value={7}>expires in 7 days</option>
          <option value={30}>expires in 30 days</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={invite.isPending}
          className="min-h-11"
          onClick={() => invite.mutate()}
        >
          Create invite link
        </Button>
        {invite.error && (
          <p className="w-full text-xs text-destructive">
            {invite.error.message}
          </p>
        )}
      </div>
      <AnimatePresence>
        {link && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="mt-3 flex items-center gap-2"
          >
            <Input
              className="font-mono text-xs"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function InvitesTable() {
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => listInvites(),
    retry: false,
  })

  const counts = { pending: 0, used: 0, expired: 0 }
  for (const i of invites.data ?? []) counts[inviteStatus(i)]++

  return (
    <section>
      <h2 className="text-lattice-heading font-semibold tracking-tight">
        Invites
      </h2>
      {invites.isPending ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
      ) : invites.error ? (
        <p className="mt-4 text-sm text-destructive">
          {invites.error instanceof ApiError
            ? invites.error.message
            : 'Could not load invites.'}
        </p>
      ) : invites.data.length > 0 ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {counts.pending} pending · {counts.used} joined · {counts.expired}{' '}
            expired
          </p>
          <div className="mt-4 overflow-x-auto border-y border-border bg-card">
            <table className="w-full text-sm">
              <thead className="fieldnotes-kicker border-b border-border bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invites.data.map((i) => {
                  const status = inviteStatus(i)
                  return (
                    <tr key={i.id}>
                      <td className="px-4 py-3 capitalize">{i.role}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(i.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`border-0 capitalize ${STATUS_STYLE[status]}`}
                        >
                          {status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {status === 'used'
                          ? `${i.used_by_email} on ${fmtDate(i.used_at!)}`
                          : status === 'pending'
                            ? `expires ${fmtDate(i.expires_at)}`
                            : 'never used'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No invites yet — create one above.
        </p>
      )}
    </section>
  )
}

function PeopleTable() {
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(),
    retry: false,
  })

  return (
    <section>
      <h2 className="text-lattice-heading font-semibold tracking-tight">
        People
      </h2>
      {users.isPending ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
      ) : users.error ? (
        <p className="mt-4 text-sm text-destructive">
          {users.error instanceof ApiError
            ? users.error.message
            : 'Could not load people.'}
        </p>
      ) : users.data.length > 0 ? (
        <div className="mt-4 overflow-x-auto border-y border-border bg-card">
          <table className="w-full text-sm">
            <thead className="fieldnotes-kicker border-b border-border bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">
                    {u.role}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(u.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Nobody yet.</p>
      )}
    </section>
  )
}
