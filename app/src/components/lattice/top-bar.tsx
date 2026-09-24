import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { getMe } from '#/lib/api'
import { useUser } from '#/lib/user'

/**
 * The Lattice glyph: a rounded tile with a lattice of crossing lines.
 * `onDark` swaps the tile fill for use on the app's own dark green
 * backgrounds, where the default fill would otherwise blend in and vanish.
 */
export function LogoMark({ onDark = false }: { onDark?: boolean }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        width="28"
        height="28"
        rx="3"
        fill={onDark ? '#f3efe6' : 'var(--foreground)'}
      />
      <g
        stroke={onDark ? '#b6402c' : 'var(--background)'}
        strokeWidth="1.6"
        strokeLinecap="square"
      >
        <path d="M10 7v14M18 7v14M7 10h14M7 18h14" />
      </g>
    </svg>
  )
}

function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TopBar() {
  const user = useUser()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    retry: false,
  })
  const isInstructor = ['instructor', 'admin'].includes(
    me.data?.user.role ?? '',
  )
  const initial = (user.trim().charAt(0) || '?').toUpperCase()

  return (
    <header className="w-full border-b border-border px-5 sm:px-10">
      <div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-4">
        <Link
          to="/"
          className="group flex min-h-11 items-center gap-3 rounded-sm"
        >
          <LogoMark />
          <span className="text-2xl font-semibold tracking-[-0.05em]">
            Lattice<span className="text-primary">.</span>
          </span>
          <span className="fieldnotes-kicker ml-4 hidden border-l border-border pl-5 text-muted-foreground md:block">
            For the curious mind
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Account menu for ${user || 'your account'}`}
            className="flex min-h-11 items-center gap-2 rounded-sm border border-border py-1.5 pr-2.5 pl-1.5 transition-colors hover:bg-card aria-expanded:bg-card"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-xs bg-foreground font-mono text-xs font-semibold text-background"
            >
              {initial}
            </span>
            <span className="hidden max-w-[200px] truncate text-sm font-medium text-foreground sm:inline">
              {user || 'Account'}
            </span>
            <Chevron />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="truncate">{user}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isInstructor && (
              <DropdownMenuItem asChild>
                <Link to="/manage">Manage access</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <a href="/auth/logout">Sign out</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
