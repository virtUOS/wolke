// Reaching the global search field (issue #171).
//
// Since the entry point moved into the app bar, "the search field" is not
// unconditionally on the page: a desktop bar carries the field itself, a phone
// carries a "Suchen" pill that reveals it. Every spec that searches goes
// through here rather than restating that split.

import { expect, type Locator, type Page } from '@playwright/test'

/** The app bar's search entry point on a phone — the pill, before it is tapped. */
export function searchPill(page: Page): Locator {
  return page
    .getByRole('banner')
    .getByRole('button', { name: /Alle Dienste durchsuchen|Search all services/i })
}

/**
 * Returns the global search field, revealing it first if this viewport keeps it
 * behind the phone pill. The field comes back focused, so a `fill()` behaves
 * the same at every matrix size.
 */
export async function openSearch(page: Page): Promise<Locator> {
  const field = page.getByRole('searchbox')
  if ((await field.count()) === 0) {
    await searchPill(page).click()
  }
  await expect(field).toBeVisible()
  return field
}

/**
 * Puts the search away and clears it.
 *
 * A phone spec that goes on to use the app bar must call this: the revealed
 * field covers the whole bar row, so the bell and the avatar are behind it
 * until it closes. On a desktop there is nothing to close and the query is
 * simply cleared.
 */
export async function closeSearch(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: /Suche schließen|Close search/ })
  if ((await close.count()) > 0) {
    await close.click()
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    return
  }
  await page.getByRole('searchbox').fill('')
}
