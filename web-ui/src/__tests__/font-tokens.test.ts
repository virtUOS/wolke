import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyBrandingTokens, type Branding } from '@/lib/branding'
import { BRANDING } from '@/test/branding'

// Issue #214: `--font-body` and `--font-display` become branding tokens.
//
// #213 introduced the two variables and pointed every call site at them; this
// issue adds the payload behind them, so a deployment selects a family in
// branding.yaml instead of editing the stylesheet. The tokens are NOT
// per-theme — one face across light and dark — so they arrive in their own
// `fonts` object and land on :root only.
//
// What this file pins is the wiring: which object becomes which variable, in
// which block. That the variable actually changes the *rendered* face is not
// checkable in jsdom (it resolves no fonts at all), so it is proved in a real
// engine by e2e/issue-214-font-tokens.spec.ts.

const branding: Branding = {
  ...BRANDING,
  theme: { light: { primary: '#A6093D' }, dark: { primary: '#C2355C' } },
  fonts: { body: "'Corporate Sans', system-ui, sans-serif", display: "'Corporate Display', system-ui, sans-serif" },
}

/** The `:root { … }` and `.dark { … }` halves of the injected stylesheet. */
function injected() {
  applyBrandingTokens(branding)
  const css = document.getElementById('branding-tokens')?.textContent ?? ''
  const root = css.match(/:root \{([^}]*)\}/)?.[1] ?? ''
  const dark = css.match(/\.dark \{([^}]*)\}/)?.[1] ?? ''
  return { css, root, dark }
}

describe('applyBrandingTokens turns the font roles into CSS variables', () => {
  it('emits --font-body and --font-display from the payload', () => {
    const { root } = injected()
    expect(root).toContain("--font-body: 'Corporate Sans', system-ui, sans-serif;")
    expect(root).toContain("--font-display: 'Corporate Display', system-ui, sans-serif;")
  })

  it('puts them on :root only — a face is not per-theme', () => {
    const { dark } = injected()
    expect(dark).not.toContain('--font-')
  })

  it('survives a payload with no fonts at all', () => {
    // `fonts:` left out of branding.yaml (or written as an empty key, which
    // YAML hands the API as null) must not take the app down before first
    // paint: the stylesheet fallbacks are still there to be used.
    expect(() =>
      applyBrandingTokens({ ...branding, fonts: undefined as unknown as Branding['fonts'] }),
    ).not.toThrow()
    expect(document.getElementById('branding-tokens')?.textContent).toContain('--primary: #A6093D')
  })
})

describe('the stylesheet side of the tokens', () => {
  // Vitest runs from web-ui/, so this is the stylesheet the app ships.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  function token(name: string): string | undefined {
    const body = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1]
    return body?.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  }

  it('bridges both roles into the Tailwind utility form', () => {
    const theme = css.match(/@theme inline \{([\s\S]*?)^\}/m)?.[1] ?? ''
    expect(theme).toContain('--font-body: var(--font-body);')
    expect(theme).toContain('--font-display: var(--font-display);')
  })

  it('keeps a first-paint fallback for each role, ending in a generic family', () => {
    for (const role of ['font-body', 'font-display']) {
      const value = token(role)
      expect(value).toBeDefined()
      expect(value).toMatch(/(sans-serif|serif|monospace|system-ui)$/)
    }
  })

  it('reads the body face from the token rather than naming a family', () => {
    const body = css.match(/^body \{([\s\S]*?)^\}/m)?.[1] ?? ''
    expect(body).toContain('font-family: var(--font-body);')
    expect(body).not.toMatch(/font-family:\s*['"]/)
  })
})
