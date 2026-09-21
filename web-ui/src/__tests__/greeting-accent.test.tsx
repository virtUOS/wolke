import { render, screen } from '@testing-library/react'
import { Greeting } from '@/components/Greeting'
import { t } from '@/lib/i18n'

// Issue #220: the greeting's trailing full stop is set in the brand primary.
//
// "Only the punctuation" is the whole requirement, and it is structural rather
// than textual: the stop is a literal in the JSX, next to two variables. The
// salutation changes with the hour, the name is whoever is logged in, and a
// locale could legitimately end its greeting differently — so the accent is a
// wrapper around that literal and never a match against the rendered string.
//
// These assertions are written the same way: they ask what is *inside* the
// accented element, not where a regex found a dot.

function greeting(locale: string, accent: boolean) {
  const { unmount } = render(
    <Greeting
      firstName="Alex"
      locale={locale}
      isMobile={false}
      maintenanceCount={0}
      accent={accent}
      onShowMaintenance={() => {}}
    />,
  )
  const h1 = screen.getByRole('heading', { level: 1 })
  return { h1, stop: h1.querySelector('span'), unmount }
}

describe.each(['de', 'en'])('the accented full stop (%s)', (locale) => {
  const salutation = t(locale).greeting.salutation()

  it('colours the stop with the brand primary', () => {
    const { stop } = greeting(locale, true)
    expect(stop).not.toBeNull()
    expect(stop!.style.color).toBe('var(--primary)')
  })

  it('wraps the punctuation and nothing else', () => {
    const { h1, stop } = greeting(locale, true)
    // The accent's contents, exactly: one full stop.
    expect(stop!.textContent).toBe('.')
    // …and neither variable is inside it. Asserted against the values actually
    // rendered, so a locale whose salutation gained a comma or an exclamation
    // mark would still be checked for the thing that matters.
    expect(stop!.textContent).not.toContain('Alex')
    expect(stop!.textContent).not.toContain(salutation)
    // The heading still reads as one line, accent or not.
    expect(h1.textContent).toBe(`${salutation}, Alex.`)
    // One element in the heading, and it is the stop: nothing else in the line
    // has been split out and re-styled along the way.
    expect(h1.querySelectorAll('*')).toHaveLength(1)
  })

  it('leaves the stop in place when the deployment opts out', () => {
    const { h1, stop } = greeting(locale, false)
    // greeting_accent: false removes the *colour*, not the punctuation — the
    // line is a sentence either way.
    expect(stop).toBeNull()
    expect(h1.textContent).toBe(`${salutation}, Alex.`)
  })
})
