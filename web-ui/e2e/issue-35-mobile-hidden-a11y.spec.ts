// Regression spec for https://github.com/virtUOS/wolke/issues/35
// "Mobile items not all hidden to screen readers" — the phone layout drops
// information on purpose, but content that is not on the screen is still offered
// to the screen reader as a stop in the reading order (in the reporter's video,
// TalkBack lands on an empty box between the search field and the first tile).
//
// Marked fixme until the fix lands; the fix's PR removes the annotation.

import { expectNothingInvisibleAnnounced } from './helpers/a11y'
import { expect, test } from './fixtures'

test.use({ viewportChecks: [] })

test.describe('issue #35 — the accessibility tree matches what is on screen', () => {
  test.fixme(true, 'https://github.com/virtUOS/wolke/issues/35')

  test('the dashboard announces nothing it does not show', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNothingInvisibleAnnounced(page, 'dashboard')
  })

  test('the favorites tab announces nothing it does not show', async ({ page }) => {
    await page.goto('/?tab=favoriten')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNothingInvisibleAnnounced(page, 'favorites')
  })
})
