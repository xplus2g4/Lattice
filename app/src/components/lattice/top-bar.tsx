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

/** The Lattice glyph: a rounded teal tile with a lattice of crossing lines. */
function LogoMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="8" fill="#0E2622" />
      <g stroke="#5CD1BE" strokeWidth="1.6" strokeLinecap="round">
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
      className="shrink-0 text-[#5B6B67]"
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
  const me = useQuery({ queryKey: ['me'], queryFn: () => getMe(), retry: false })
  const isInstructor = ['instructor', 'admin'].includes(
    me.data?.user.role ?? '',
  )
  const initial = (user.trim().charAt(0) || '?').toUpperCase()

  return (
    <header className="sticky top-0 z-40 h-[72px] w-full border-b border-[#E3E8E6] bg-white">
      <div className="mx-auto flex h-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#0F7F6E]/40"
        >
          <LogoMark />
          <span className="text-[20px] font-bold tracking-tight text-[#0E2622]">
            Lattice
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Account menu for ${user || 'your account'}`}
            className="flex min-h-[44px] items-center gap-2 rounded-4xl border border-[#E3E8E6] bg-white py-1.5 pr-2.5 pl-1.5 transition-colors outline-none hover:bg-[#F6F8F7] focus-visible:ring-2 focus-visible:ring-[#0F7F6E]/40 aria-expanded:bg-[#F6F8F7]"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0E2622] text-sm font-semibold text-white"
            >
              {initial}
            </span>
            <span className="hidden max-w-[200px] truncate text-sm font-medium text-[#0E2622] sm:inline">
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
