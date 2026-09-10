import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold">Course knowledge store</h1>
      <p className="mt-4 text-lg">
        Ask questions scoped to a course and get cited answers from official
        materials and your own notes.
      </p>
    </main>
  )
}
