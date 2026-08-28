// Regression spec for https://github.com/virtUOS/wolke/issues/35
// "Mobile items not all hidden to screen readers" — the phone layout drops
// information on purpose, but content that was not on the screen was still
// offered to the screen reader as a stop in the reading order (in the reporter's
// video, TalkBack lands on an empty box between the search field and the first
// tile: the permanently populated result-count live region).
//
// The invariant is checked at every viewport, not just phones: announcing what
// nobody can see is wrong everywhere, and the phone layout is only where it
// became obvious.

import { expectNothingInvisibleAnnounced } from './helpers/a11y'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

test.use({ viewportChecks: [] })

test.describe('issue #35 — the accessibility tree matches what is on screen', () => {
  test('the dashboard announces nothing it does not show', async ({ page }) => {
    await gotoApp(page)
    await expectNothingInvisibleAnnounced(page, 'dashboard')
  })

  test('the services tab announces nothing it does not show', async ({ page }) => {
    await gotoApp(page, '/?tab=dienste')
    await expectNothingInvisibleAnnounced(page, 'services')
  })

  test('a search still announces the new result count', async ({ page }) => {
    // Quiet at rest is only correct if the region still does its job when the
    // result set changes. The announcement clears itself after a few seconds, so
    // this assertion has to land inside that window — toHaveText retries.
    await gotoApp(page, '/?tab=dienste')
    const liveRegion = page.locator('[aria-live="polite"]')
    await expect(liveRegion).toHaveText('')

    await page.getByRole('searchbox').fill('Netzspeicher')
    await expect(liveRegion).toHaveText(/1 Dienst/)
  })
})
