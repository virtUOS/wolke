// Regression spec for https://github.com/virtUOS/wolke/issues/97
// "UI: spacing with long category names" — in the grid card's footer the
// category label was `white-space: nowrap` next to a `shrink-0` docs pill, so a
// long German compound ("Hochschulverwaltungsanwendungen") could not give way:
// the label pushed the pill out of its corner, and at the narrowest grid column
// the row clipped its content.
//
// The invariant the fix has to hold, at every viewport that renders the grid:
// the docs pill stays anchored in the footer's trailing corner, at its full
// size, and the label never overlaps it — it wraps instead.
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

test.describe('issue #97 — a long category name keeps the docs pill anchored', () => {
  test('the docs pill holds the footer corner at its full size', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'the footer is grid-layout only (>= 768px)')

    await stubLongCategoryLabels(page)
    await gotoApp(page, '/?tab=dienste')

    // MyShare is seeded with both a service_url and a doc_url, so its card is
    // the one that renders label + pill side by side.
    const card = page.locator('.tile-grid', { has: page.getByRole('link', { name: /MyShare/ }) }).first()
    await expect(card).toBeVisible()

    const label = card.getByText(LONG_CATEGORY_DE)
    const pill = card.getByRole('link', { name: /Doku/ })
    await expect(label).toBeVisible()
    await expect(pill).toBeVisible()

    const [cardBox, labelBox, pillBox] = await Promise.all([box(card), box(label), box(pill)])

    // The pill keeps its own width — squeezed to a sliver is the defect, not a fix.
    const pillTextWidth = await pill.evaluate((el) => el.scrollWidth)
    expect(pillBox.width, 'docs pill width vs. its content').toBeGreaterThanOrEqual(pillTextWidth - 1)

    // Anchored in the trailing corner: flush with the card's content edge
    // (20px card padding), not shoved off it by the label.
    const cardRight = cardBox.x + cardBox.width
    const pillRight = pillBox.x + pillBox.width
    expect(
      cardRight - pillRight,
      `docs pill inset from the card's right edge (card ${cardBox.width}px wide)`,
    ).toBeLessThanOrEqual(21)
    expect(pillRight, 'docs pill must stay inside the card').toBeLessThanOrEqual(cardRight + 1)

    // …and the label gives way rather than running under it.
    expect(labelBox.x + labelBox.width, 'category label right edge vs. pill left edge').toBeLessThanOrEqual(
      pillBox.x + 1,
    )
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
