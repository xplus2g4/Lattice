import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LandingPage } from './landing-page'

describe('landing page preview', () => {
  beforeEach(() => {
    // jsdom does not implement modal dialog behavior.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.setAttribute('open', '')
        },
      },
      close: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.removeAttribute('open')
        },
      },
    })
    render(<LandingPage siteUrl="https://example.org/landing" />)
  })

  afterEach(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('changes the sample explanation and selected concept together', () => {
    const vectors = screen.getByRole('button', {
      name: /Vectors & spaces/,
    })
    fireEvent.click(vectors)
    expect(vectors).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('heading', { name: 'Start with vectors & spaces' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Linear transformations/ }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps registration and provider actions informational', () => {
    fireEvent.click(
      screen.getAllByRole('button', { name: /Join the waitlist/ })[0],
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'no registration has been recorded',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.click(screen.getByRole('button', { name: /Sign-in preview/ }))
    fireEvent.click(
      screen.getByRole('button', { name: /Continue with Google/ }),
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Google sign-in is a demo only.',
    )
  })

  it('uses the frontend address for sharing and offers a local Story download', () => {
    expect(screen.getByRole('link', { name: /Telegram/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https%3A%2F%2Fexample.org%2Flanding'),
    )
    fireEvent.click(screen.getByRole('button', { name: /Instagram Story/ }))
    expect(screen.getByLabelText('Website address')).toHaveValue(
      'https://example.org/landing',
    )
    expect(
      screen.getByRole('link', { name: /Download Story image/ }),
    ).toHaveAttribute('href', '/landing-assets/instagram-story.png')
  })
})
