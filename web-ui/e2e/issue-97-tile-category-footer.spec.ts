// Regression spec for https://github.com/virtUOS/wolke/issues/97
// "UI: spacing with long category names" — in the grid card's footer the
// category label was `white-space: nowrap` next to a `shrink-0` docs pill, so a
// long German compound ("Hochschulverwaltungsanwendungen") could not give way:
// the label pushed the pill out of its corner, and at the narrowest grid column
// the row clipped its content.
//
// Issue #185 moved the docs control out of the footer: it is now the guide
// (help) link in the header cluster beside the star, and the footer holds
// only the label. The invariant that remains is the one that mattered: the
// label wraps inside its own box instead of clipping, and the footer stays
// label-only at every viewport that renders the grid — nothing can be pushed
// out of a corner that no longer has a control in it.
//
// The footer only exists in the grid layout (>= 768px; a phone renders the list
// row, which has no footer), so the geometry assertions skip the phone
// projects. The phone widths are still exercised: the stubbed long label runs
// through the list row there, and the fixture's viewport health check covers
// the final state on every project in the matrix.

import type { Locator, Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** A worst-case real category name: one unbreakable 31-character compound. */
const LONG_CATEGORY_DE = 'Hochschulverwaltungsanwendungen'

/** Rewrites every category label in /api/catalog to the worst-case compound. */
async function stubLongCategoryLabels(page: Page) {
  await page.route('**/api/catalog', async (route) => {
    const catalog = await (await page.request.get('/api/catalog')).json()
    for (const category of catalog.categories) {
      category.label = { de: LONG_CATEGORY_DE, en: LONG_CATEGORY_DE }
    }
    await route.fulfill({ json: catalog })
  })
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  expect(b, 'element has no box').not.toBeNull()
  return b!
}

test.describe('issue #97 — a long category name keeps the footer intact', () => {
  test('the footer is label-only and the guide link lives in the header cluster', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'the footer is grid-layout only (>= 768px)')

    await stubLongCategoryLabels(page)
    await gotoApp(page, '/?tab=dienste')

    // MyShare is seeded with both a service_url and a doc_url, so its card is
    // the one that renders the guide link beside the star.
    const card = page.locator('.tile-grid', { has: page.getByRole('link', { name: /MyShare/ }) }).first()
    await expect(card).toBeVisible()

    const label = card.getByText(LONG_CATEGORY_DE)
    const help = card.getByRole('link', { name: /^Anleitung öffnen/ })
    const star = card.getByRole('button', { name: /Favoriten/ })
    await expect(label).toBeVisible()
    await expect(help).toBeVisible()
    await expect(star).toBeVisible()

    // The footer (the label's row) carries no control any more.
    const footer = label.locator('xpath=..')
    await expect(footer.locator('a, button')).toHaveCount(0)

    const [cardBox, labelBox, helpBox, starBox] = await Promise.all([box(card), box(label), box(help), box(star)])

    // The label owns the footer's width and stays inside the card.
    expect(labelBox.x + labelBox.width, 'label right edge vs. card').toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)

    // The guide link sits directly left of the star, on the star's row.
    expect(helpBox.x + helpBox.width, 'guide link right edge vs. star left edge').toBeLessThanOrEqual(starBox.x + 1)
    expect(starBox.x - (helpBox.x + helpBox.width), 'gap between guide link and star').toBeLessThanOrEqual(8)
    expect(Math.abs(helpBox.y - starBox.y), 'guide link and star top-aligned').toBeLessThanOrEqual(1)
    // …and above the label, not in its row.
    expect(helpBox.y + helpBox.height, 'guide link sits above the footer').toBeLessThanOrEqual(labelBox.y)
  })

  test('the long label wraps inside the card instead of clipping', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'the footer is grid-layout only (>= 768px)')

    await stubLongCategoryLabels(page)
    await gotoApp(page, '/?tab=dienste')

    // The grid renders once the stubbed /api/catalog resolves; wait for it
    // before counting, or an empty count silently passes for zero labels.
    await expect(page.locator('.tile-grid').first()).toBeVisible()
    const labels = page.locator('.tile-grid').getByText(LONG_CATEGORY_DE)
    const count = await labels.count()
    expect(count, 'grid cards rendering the stubbed category label').toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const label = labels.nth(i)
      const { clipped, wrapped, what } = await label.evaluate((el) => ({
        clipped: el.scrollWidth > el.clientWidth + 1,
        wrapped: getComputedStyle(el).whiteSpace !== 'nowrap',
        what: `${el.tagName.toLowerCase()} white-space: ${getComputedStyle(el).whiteSpace}`,
      }))
      expect(clipped, `category label ${i} clips its text (${what})`).toBe(false)
      expect(wrapped, `category label ${i} must be allowed to wrap (${what})`).toBe(true)
    }
  })

  test('the phone list row absorbs the long label too', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile !== true, 'list layout is the phone layout')

    await stubLongCategoryLabels(page)
    await gotoApp(page, '/?tab=dienste')
    await expect(page.locator('.tile-list-item').first()).toBeVisible()
    // The fixture's viewport health check runs against this state.
  })
})
