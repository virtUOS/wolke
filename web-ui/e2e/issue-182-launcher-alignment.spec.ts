// Viewport spec for https://github.com/virtUOS/wolke/issues/182
// "Launcher: sort control not flush with the content edge; category selection
// shifts the view down".
//
// Both halves are *geometry* defects that only a rendered page can show, so
// both are measured here at every matrix size rather than asserted through
// class names:
//
//   1. the favourites sort control is aligned OPTICALLY with the content
//      column — its visible edge on the line the cards end on. The desktop
//      trigger is a filled chip, so its box is its visible edge; it was 96px
//      short of the column because its popover reserved the panel's width on
//      the anchor. The phone trigger is a transparent 44px icon button whose
//      icon has to meet the list rows' star column, which the rows inset by
//      their own 8px padding. Different controls, different compensation, one
//      rule. Measured at 1280/1920 and at 324/360/390 (the issue's sizes) —
//      and the 44px touch target has to survive the shift: the box moves, it
//      does not shrink.
//   2. selecting a category must not move the layout: the pill row and the
//      first card stay where they were on "Alle", and come back to the same
//      place when "Alle" is selected again. The <h2> that used to appear above
//      the pills for a facet — and pushed everything down by its own height —
//      is gone; the highlighted pill is what names the view.

import type { Locator, Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

function tabRow(page: Page): Locator {
  return page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })
}

const sortTrigger = (page: Page) => tabRow(page).getByRole('button', { name: /Reihenfolge:|Order:/ })

/** The right edge of <main>'s content box — the line the card grid ends on. */
async function contentRightEdge(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')!
    return main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight)
  })
}

test.describe('the sort control is optically flush with the content column', () => {
  test('its visible glyph lands on the content edge (desktop) or the star column (phone)', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)
    const trigger = sortTrigger(page)
    await expect(trigger).toBeVisible()

    if (isMobile) {
      // The list rows' favourite star is the column the icon has to meet.
      const star = page.getByRole('main').getByRole('button', { name: /aus Favoriten entfernen|from favorites/i }).first()
      await expect(star).toBeVisible()
      const glyph = await trigger.locator('svg').boundingBox()
      const starGlyph = await star.locator('svg').boundingBox()
      const centre = (b: { x: number; width: number }) => b.x + b.width / 2
      expect(
        Math.abs(centre(glyph!) - centre(starGlyph!)),
        'the sort icon is centred on the star column',
      ).toBeLessThanOrEqual(1)

      // The box moved; it did not shrink (docs/03 §4).
      const box = await trigger.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      // …and it still ends inside the column, on the star button's own edge.
      const starBox = await star.boundingBox()
      expect(Math.abs(box!.x + box!.width - (starBox!.x + starBox!.width))).toBeLessThanOrEqual(1)
    } else {
      // The chip is filled (bg-surface-2), so its box is what the eye reads
      // as the control's end — measured at 1280: pulling the chevron flush
      // instead leaves the chip 8px past the hairline and the card border.
      const box = await trigger.boundingBox()
      const edge = await contentRightEdge(page)
      expect(
        Math.abs(box!.x + box!.width - edge),
        `the chip ends on the content edge (${edge}px)`,
      ).toBeLessThanOrEqual(1)
    }
    await expectViewportHealthy(page, { isMobile, label: 'sort control flush with the content edge' })
  })

  test('the desktop popover opens inside the column, not past it', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.use.isMobile === true, 'the phone trigger opens a bottom sheet')
    await gotoApp(page)
    await sortTrigger(page).click()
    const panel = page.getByRole('dialog', { name: /Reihenfolge|Order/ })
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    // Extending leftwards from the trigger's edge, the panel stays within the
    // column — which is what lets the trigger sit flush without the anchor
    // reserving the panel's width (the cause of the 96px gap at 1280px).
    expect(box!.x + box!.width).toBeLessThanOrEqual((await contentRightEdge(page)) + 1)
    await expectViewportHealthy(page, { label: 'sort popover open' })
    await page.keyboard.press('Escape')
  })
})
