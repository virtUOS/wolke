// Regression spec for https://github.com/virtUOS/wolke/issues/112
// "avoid breaking up words on line break" — hyphens-auto (issue #23) let the
// browser hyphenate whichever word happened to sit at the line-filling point,
// even a short one: "Dokumente und Da-teien" instead of the cleaner
// "Dokumente und\nDateien". The fix adds hyphenate-limit-chars: 12 5 4 to the
// shared `.hyphenate-compound` convention (index.css) — a word under 12
// characters can never be hyphenated at all now, so a short word either fits
// whole or wraps whole; only a genuinely long compound still hyphenates.
//
// Two guardrails, both directions:
//  - the computed-style assertion: every element using the shared convention
//    carries the tightened rule (this alone catches a per-callsite regression
//    that drops back to plain hyphens-auto).
//  - the over-limit compound from issue #23 must still wrap/hyphenate instead
//    of overflowing its box — the tightened limit must not turn hyphenation
//    off altogether.
//
// A third guardrail was attempted per the issue's own example — assert
// "Dokumente und Dateien" renders "Dateien" as one unbroken line box — using
// the Range/getClientRects technique from account-menu.spec.ts. It proved too
// brittle to keep: at the real column widths this app renders at 360×800 (and
// even a deliberately narrowed synthetic column), this Chromium build's
// hyphenation engine never chose to hyphenate "Dateien" pre-fix either — it
// already treated hyphenation as a last resort whenever the whole word had
// room on the next line, so the assertion passed identically with the fix
// reverted and proved nothing. The only width at which the pre-fix build
// actually reproduced a "Da-teien" split was one too narrow for "Dateien" to
// fit *at all* (~46px in the real production font) — there both builds still
// break the word across two lines, the fix just drops the hyphen glyph for
// the raw break instead of leaving it hyphenated, which the DOM has no way to
// assert (the hyphen is a rendered glyph, not textContent). Per this spec's
// own instructions, relying on the computed-style assertion plus the PR's
// screenshots instead of a synthetic, non-discriminating line-box check.
//
// Firefox does not implement hyphenate-limit-chars (documented at the CSS
// rule itself) and keeps today's line-filler behavior — a degradation, not a
// regression, since hyphens-auto still wraps correctly there too.

import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The worst-case real compound from issue #23/#97 — must still wrap, not overflow. */
const LONG_COMPOUND_DE = 'Hochschulverwaltungsanwendungen'

/** Rewrites every category label in /api/catalog to `label`. */
async function stubCategoryLabels(page: import('@playwright/test').Page, label: string) {
  await page.route('**/api/catalog', async (route) => {
    const catalog = await (await page.request.get('/api/catalog')).json()
    for (const category of catalog.categories) {
      category.label = { de: label, en: label }
    }
    await route.fulfill({ json: catalog })
  })
}

test.describe('issue #112 — hyphenation is a last resort, not a line-filler', () => {
  test('the shared convention carries hyphenate-limit-chars', async ({ page }) => {
    await gotoApp(page, '/?tab=dienste')
    const el = page.locator('.hyphenate-compound').first()
    await expect(el).toBeVisible()
    const style = await el.evaluate((e) => getComputedStyle(e).hyphenateLimitChars)
    // Firefox reports '' for an unsupported property; Chromium (this suite's
    // engine) reports the value verbatim.
    expect(style, 'hyphenate-limit-chars on .hyphenate-compound').toBe('12 5 4')
  })

  test('an over-limit compound still wraps instead of overflowing (issue #23 guard)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile !== true, 'the narrow phone column reproduces the overflow risk')

    await stubCategoryLabels(page, LONG_COMPOUND_DE)
    await gotoApp(page, '/?tab=dienste')
    await expect(page.locator('.tile-list-item').first()).toBeVisible()
    // The category footer only exists in the grid layout; the list row (phone)
    // doesn't render it at all, so the real guard here is the tile name/
    // description, which do carry the shared class and the longest seeded
    // compound (Identitätsmanagement, from dashboard.spec.ts). Confirm no
    // element carrying the class clips its content anywhere on the page.
    const overflowing = await page.$$eval('.hyphenate-compound', (els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent ?? '').slice(0, 40)),
    )
    expect(overflowing, 'elements clipping their text').toEqual([])
  })
})
