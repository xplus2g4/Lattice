import { createFileRoute } from '@tanstack/react-router'

import { LandingPage, landingHead } from '#/components/landing/landing-page'

// Public: `/` sends a signed-out visitor here; a signed-in one can still read it.
export const Route = createFileRoute('/landing')({
  head: () => landingHead,
  component: LandingPage,
})
