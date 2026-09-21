import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { Greeting } from '@/components/Greeting'

// Issue #213: the launcher's display voice drops the serif — and issue #220
// settles the weight device testing left open.
//
// The UOS corporate design permits no serif face on the web, and the decision
// on that issue is option (a): the display role uses the *body* family rather
// than a second sans, so the greeting's distinction comes from weight and size
// alone. That is what makes it survive a deployer's --font-display override
// (issue #214) — whatever family is substituted, the contrast with the text
// under it is still there.
//
// These tests pin the typography itself because nothing else does: it lives in
// inline styles, so a stray edit has no type error and no visual test to fail.

const FAMILY = 'var(--font-display)'

function greeting(isMobile = false) {
  const { unmount } = render(
    <Greeting
      firstName="Alex"
      locale="de"
      isMobile={isMobile}
      maintenanceCount={0}
      accent={false}
      onShowMaintenance={() => {}}
    />,
  )
  return { h1: screen.getByRole('heading', { level: 1 }), unmount }
}

describe('the greeting is set in the display token, not a serif', () => {
  it('takes its family from the token rather than naming a face', () => {
    const { h1 } = greeting()
    expect(h1.style.fontFamily).toBe(FAMILY)
    // The point of the issue: no serif reaches a web surface.
    expect(h1.style.fontFamily).not.toMatch(/serif|Newsreader|Georgia/i)
  })

  it('carries the decided weight, tracking and leading', () => {
    const { h1 } = greeting()
    // 500, not the 300 #213 left open: on a real device 300 read flimsy, and
    // the replacement treatment (issue #220, board option 10d) pairs the
    // heavier weight with tighter tracking. Both are real instances of the
    // variable face (wght 100-900) — nothing is synthesised.
    expect(h1.style.fontWeight).toBe('500')
    expect(h1.style.letterSpacing).toBe('-0.015em')
    expect(h1.style.lineHeight).toBe('1.05')
    expect(h1.style.color).toBe('var(--text)')
  })

  // The two sizes the launcher actually has. `isMobile` is the shell's single
  // 768px switch, so the small size is the *phone* size and a tablet (768×1024
  // in the viewport matrix) takes the large one — see the PR for why this is
  // two tiers and not three.
  it('is 36px above the phone breakpoint and 27px below it', () => {
    const { h1, unmount } = greeting(false)
    expect(h1.style.fontSize).toBe('36px')
    unmount()
    expect(greeting(true).h1.style.fontSize).toBe('27px')
  })

  it('sets the name in the same run as the salutation', () => {
    const { h1 } = greeting()
    // One text run, no nested element re-styling the name: the decision is
    // explicit that the name carries no separate colour or weight. With the
    // accent off (this suite's default) that leaves the heading with no child
    // elements at all — the accented stop is the only one there ever is, and
    // greeting-accent.test.tsx owns it.
    expect(h1.textContent).toContain('Alex')
    expect(h1.querySelectorAll('*')).toHaveLength(0)
  })
})

describe('the font tokens', () => {
  // Vitest runs from web-ui/, so this is the stylesheet the app ships.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  it('define the display role as the body family', () => {
    // Scoped to the :root block on purpose: since issue #214 both names also
    // appear in the @theme inline bridge, where their value is var(--font-…)
    // rather than a stack, and an unscoped match reads that one first.
    const root = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1] ?? ''
    const body = root.match(/--font-body:\s*([^;]+);/)
    const display = root.match(/--font-display:\s*([^;]+);/)
    expect(body?.[1]).toBeDefined()
    expect(display?.[1]).toBeDefined()
    // Option (a): same stack. The token stays a separate name so a deployer can
    // still override one role without the other (issue #214) — these are only
    // the first-paint fallbacks now; the served defaults are pinned in Go.
    expect(display![1].trim()).toBe(body![1].trim())
  })

  it('leaves no serif face bundled', () => {
    expect(css).not.toMatch(/Newsreader/i)
  })
})
