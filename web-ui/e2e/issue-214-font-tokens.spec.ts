// Issue #214: typography is runtime config. `branding.fonts` in the mounted
// config file selects the family for each role, is served by GET /api/branding,
// and reaches the page as --font-body / --font-display.
//
// The unit suites pin the wiring: config.go's defaults and validation
// (internal/config/font_tokens_test.go), the payload (internal/server), and
// which object becomes which variable (src/__tests__/font-tokens.test.ts).
// None of them can show that the indirection *works*, because a font stack is
// a list of wishes: jsdom resolves no fonts at all, and reading the variable's
// text back only proves the string travelled. What matters to a deployer is
// which face the browser ended up drawing with.
//
// So this spec asserts the resolved family, via CDP's platform-font report —
// the same data DevTools' "Rendered Fonts" panel shows — and drives the change
// through a rewritten /api/branding response rather than by poking the
// variable, so the whole chain is under test: payload → applyBrandingTokens →
// variable → the glyphs on screen.

import type { Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The greeting — the one display-role surface on the launcher (issue #213). */
const DISPLAY = 'h1'
/** A service name in the tile grid (or the mobile list row): plain body text. */
const BODY = '.hyphenate-compound'

/**
 * The family the engine actually drew `selector` with, by glyph count.
 *
 * getComputedStyle would only hand back the declared stack — every family in
 * it, including the ones that failed to load — which is exactly the thing this
 * spec must not trust.
 */
async function renderedFamily(page: Page, selector: string): Promise<string> {
  const client = await page.context().newCDPSession(page)
  try {
    await client.send('DOM.enable')
    await client.send('CSS.enable')
    const { root } = await client.send('DOM.getDocument')
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    expect(nodeId, `no element matched ${selector}`).toBeTruthy()
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId })
    const used = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0]
    expect(used, `nothing was drawn for ${selector}`).toBeTruthy()
    return used.familyName
  } finally {
    await client.detach()
  }
}

/**
 * Serves a /api/branding whose `fonts` carry `overrides`, the way a deployment
 * setting `branding.fonts` in its config file would, and reloads into it.
 *
 * Unrouted and reloaded again at the end of the test: the auto viewport guard
 * (fixtures.ts) checks whatever state the test leaves behind, and a test that
 * left a deliberately wrong face on screen would be reporting that face's
 * overflows, not the app's.
 */
async function withFonts(page: Page, overrides: Record<string, string>, body: () => Promise<void>) {
  await page.route('**/api/branding', async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({ response, json: { ...payload, fonts: { ...payload.fonts, ...overrides } } })
  })
  try {
    await gotoApp(page)
    await body()
  } finally {
    await page.unroute('**/api/branding')
    await gotoApp(page)
  }
}

test('the bundled face is what the default skin actually renders', async ({ page }) => {
  await gotoApp(page)

  // The whole chain, in one assertion: config.go's default → the payload → the
  // injected variable → the glyphs. A stack whose first family failed to load
  // would report a system fallback here instead.
  expect(await renderedFamily(page, BODY)).toContain('Hanken Grotesk')

  // …and the default is a visual no-op across the two roles: since issue #213
  // the display role is the body family, so both draw with the same face.
  expect(await renderedFamily(page, DISPLAY)).toBe(await renderedFamily(page, BODY))

  // The variables themselves come from the payload, not from the stylesheet
  // fallbacks — those two agree today, so assert the source rather than the
  // value: a skin changing this must move the page with it.
  const { served, resolved } = await page.evaluate(async () => {
    const payload = await fetch('/api/branding').then((r) => r.json())
    const style = getComputedStyle(document.documentElement)
    return {
      served: { body: payload.fonts.body, display: payload.fonts.display },
      resolved: {
        body: style.getPropertyValue('--font-body').trim(),
        display: style.getPropertyValue('--font-display').trim(),
      },
    }
  })
  expect(resolved.body).toBe(served.body)
  expect(resolved.display).toBe(served.display)
})

test('selecting a display family in branding config changes the face the greeting is drawn in', async ({ page }) => {
  await gotoApp(page)
  const before = { display: await renderedFamily(page, DISPLAY), body: await renderedFamily(page, BODY) }

  // A family no machine has, followed by a generic that every machine resolves
  // differently from the bundled grotesque: this is also the fallback rule
  // (issue #214, rule 5) doing its job — the named face is missing and the text
  // still renders, in a system face rather than in nothing.
  await withFonts(page, { display: "'No Such Face', monospace" }, async () => {
    const after = { display: await renderedFamily(page, DISPLAY), body: await renderedFamily(page, BODY) }
    expect(after.display).not.toBe(before.display)
    // …and only the display role moved. Two tokens, two roles: re-facing the
    // greeting must not re-face the launcher under it.
    expect(after.body).toBe(before.body)
  })
})

test('selecting a body family leaves the display role alone', async ({ page }) => {
  await gotoApp(page)
  const before = { display: await renderedFamily(page, DISPLAY), body: await renderedFamily(page, BODY) }

  await withFonts(page, { body: "'No Such Face', monospace" }, async () => {
    const after = { display: await renderedFamily(page, DISPLAY), body: await renderedFamily(page, BODY) }
    expect(after.body).not.toBe(before.body)
    expect(after.display).toBe(before.display)
  })
})
