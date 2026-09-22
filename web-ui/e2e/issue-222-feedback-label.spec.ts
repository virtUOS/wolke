// Issue #222: the footer feedback link's label is branding config
// (`branding.feedback_label`, localized `{de, en}`).
//
// The unit suites already pin the mechanism: the config field and its
// normalization (internal/config/feedback_label_test.go), the payload
// (internal/server/branding_test.go) and the fallback table
// (src/__tests__/feedback-label.test.tsx). What none of them can show is what a
// *rename* does to the footer's layout, and that is the interesting half: the
// link is right-aligned with `margin-left: auto` in a wrapping flex row next to
// the imprint and privacy links, so its width was previously fixed by a word we
// chose. A deployment can now put a long German compound there.
//
// So this spec drives a real rename through /api/branding and lets the shared
// viewport guard (fixtures.ts) check the resulting footer at every matrix width
// — 324px included, where a long label has to wrap rather than push the row
// past the edge.

import type { Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const URL = 'https://tickets.example.edu/neu'

/** A plausible worst case, not a synthetic one: a compound of the kind a German
 *  university actually writes on a help-desk link. */
const LONG_LABEL = 'Störungsmeldung & Verbesserungsvorschläge'

/**
 * Serves a /api/branding carrying `overrides`, the way a deployment's config
 * file would, and reloads into it.
 *
 * Unrouted and reloaded at the end: the auto viewport guard checks whatever
 * state the test leaves behind, and it should be checking the app, not a
 * leftover stub.
 */
async function withBranding(page: Page, overrides: Record<string, unknown>, body: () => Promise<void>) {
  await page.route('**/api/branding', async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({ response, json: { ...payload, ...overrides } })
  })
  try {
    await gotoApp(page)
    await body()
  } finally {
    await page.unroute('**/api/branding')
    await gotoApp(page)
  }
}

/** The footer's feedback link, addressed by its href — its text is the thing
 *  under test, so it can never be the selector. */
function feedbackLink(page: Page) {
  return page.locator(`footer a[href="${URL}"]`)
}

test('the default skin keeps the built-in label', async ({ page }) => {
  await withBranding(page, { feedback_url: URL }, async () => {
    // The suite runs in de-DE (playwright.config.ts), where the built-in label
    // is "Feedback" — configuring nothing must change nothing.
    await expect(feedbackLink(page)).toHaveText('Feedback')
  })
})

test('a configured label renames the link without touching the link', async ({ page }) => {
  await withBranding(
    page,
    { feedback_url: URL, feedback_label: { de: 'Kontakt', en: 'Contact' } },
    async () => {
      const link = feedbackLink(page)
      await expect(link).toHaveText('Kontakt')
      // Still the same link: an http(s) target opens in a new tab, with the rel
      // that goes with it. The label is a label.
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    },
  )
})

test('a long label stays inside the footer at every width', async ({ page }) => {
  await withBranding(page, { feedback_url: URL, feedback_label: { de: LONG_LABEL } }, async () => {
    const link = feedbackLink(page)
    await expect(link).toHaveText(LONG_LABEL)

    // The overflow, readability and touch-target checks run automatically
    // against this state (fixtures.ts) at each of the six matrix viewports —
    // 324px is the one that matters here. This adds the assertion the generic
    // guard cannot make: the link's right edge must stay inside the footer's
    // content box, i.e. the `margin-left: auto` row wrapped instead of being
    // pushed past its own container.
    const box = await link.boundingBox()
    const footer = await page.locator('footer').boundingBox()
    expect(box, 'the renamed link is not rendered').not.toBeNull()
    expect(footer).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(footer!.x + footer!.width + 1)
    expect(box!.x).toBeGreaterThanOrEqual(footer!.x - 1)
  })
})
