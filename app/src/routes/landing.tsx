import { createFileRoute } from '@tanstack/react-router'

import { LandingPage } from '#/components/landing/landing-page'

// Configure the public origin at build time so crawlers receive absolute URLs.
const origin = new URL(import.meta.env.VITE_SITE_URL || 'http://localhost:3000')
const siteUrl = new URL('/landing', origin).href
const imageUrl = new URL('/landing-assets/social-preview.png', origin).href
const title = 'Lattice — Stay curious. Go a little deeper.'
const description =
  'Ask questions about your course and get answers from its own Materials and your Notes, with Citations back to the exact Page.'

export const Route = createFileRoute('/landing')({
  head: () => ({
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Lattice' },
      { property: 'og:locale', content: 'en_SG' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: siteUrl },
      { property: 'og:image', content: imageUrl },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Lattice' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:url', content: siteUrl },
      { name: 'twitter:image', content: imageUrl },
      { name: 'twitter:image:alt', content: 'Lattice' },
    ],
    links: [{ rel: 'canonical', href: siteUrl }],
  }),
  component: LandingPage,
})
