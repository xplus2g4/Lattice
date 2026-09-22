import { Link, createFileRoute } from '@tanstack/react-router'
import { QuizPanel } from '#/components/lattice/quiz-panel'
import { AskPanel } from '#/components/lattice/ask-panel'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet'
import { useUser } from '#/lib/user'
import '#/components/lattice/quiz-workspace.css'

export const Route = createFileRoute('/courses/$course/quizzes')({
  validateSearch: (search: Record<string, unknown>): { quiz?: string } => ({
    quiz: typeof search.quiz === 'string' ? search.quiz : undefined,
  }),
  component: Quizzes,
})

function Quizzes() {
  const { course } = Route.useParams()
  const { quiz, material } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [user] = useUser()
  return (
    <div className="quiz-workspace flex h-full min-h-0 bg-background text-foreground lg:overflow-hidden">
      <main className="min-w-0 flex-1 lg:overflow-y-auto">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <Link
              to="/courses/$course"
              params={{ course }}
              search={{ material }}
              className="shrink-0 uppercase text-muted-foreground hover:text-primary"
            >
              {course}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium">
              {material ?? 'Practice'}
            </span>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="xl:hidden">
                Ask Lattice
              </Button>
            </SheetTrigger>
            <SheetContent className="quiz-workspace flex w-full flex-col gap-0 p-0 sm:max-w-md">
              <SheetHeader className="border-b p-5">
                <SheetTitle>Ask Lattice</SheetTitle>
              </SheetHeader>
              <AskPanel course={course} user={user} />
            </SheetContent>
          </Sheet>
        </header>
        <QuizPanel
          key={`${user}:${course}`}
          course={course}
          user={user}
          quizId={quiz}
          initialMaterial={material}
          onSelect={(id) =>
            void navigate({ search: (prev) => ({ ...prev, quiz: id }) })
          }
        />
      </main>
      <aside
        aria-label="Ask Lattice"
        className="hidden w-80 shrink-0 flex-col border-l bg-card xl:flex"
      >
        <div className="space-y-2 border-b p-5">
          <h2 className="font-semibold">Ask Lattice</h2>
          <p className="text-xs uppercase text-muted-foreground">
            {course} · Course questions
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Answers draw on this course’s Materials and your included Notes.
          </p>
        </div>
        <AskPanel course={course} user={user} />
      </aside>
    </div>
  )
}
