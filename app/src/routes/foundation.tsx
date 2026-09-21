import { createFileRoute } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/foundation')({
  component: FoundationPreview,
})

function FoundationPreview() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 border-b border-border pb-8">
          <p className="text-lattice-meta font-semibold tracking-wide text-primary">
            LATTICE
          </p>
          <h1 className="mt-3 text-lattice-display font-semibold tracking-tight text-foreground">
            Foundation preview
          </h1>
          <p className="mt-3 max-w-xl text-lattice-prompt text-muted-foreground">
            Calm, focused primitives for study spaces where course Material
            stays primary.
          </p>
        </header>

        <section className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-lattice">
          <Tabs defaultValue="read">
            <TabsList
              variant="line"
              className="gap-4 border-b border-border p-0"
            >
              <TabsTrigger
                value="read"
                className="rounded-none px-1 pb-3 data-active:text-primary after:bg-primary"
              >
                Read Material
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="rounded-none px-1 pb-3 data-active:text-primary after:bg-primary"
              >
                Notes
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-3">
            <Button>Ask about this slide</Button>
            <Button variant="outline">Save Note</Button>
            <Badge className="border-0 bg-source-context text-source-context-text">
              Citation · Lecture 5, slides 12–14
            </Badge>
          </div>

          <div>
            <label htmlFor="study-question" className="text-sm font-medium">
              What would you like to understand?
            </label>
            <Textarea
              id="study-question"
              className="mt-2 min-h-28 bg-background"
              placeholder="Ask a focused question about the Material…"
            />
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Learning feedback">
            <Badge className="border-0 bg-feedback-strong text-feedback-strong-text">
              Strong
            </Badge>
            <Badge className="border-0 bg-feedback-developing text-feedback-developing-text">
              Developing
            </Badge>
            <Badge className="border-0 bg-feedback-revisit text-feedback-revisit-text">
              Revisit
            </Badge>
          </div>
        </section>
      </div>
    </main>
  )
}
