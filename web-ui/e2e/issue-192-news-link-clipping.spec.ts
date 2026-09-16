// Regression spec for https://github.com/virtUOS/wolke/issues/192
// "Notification panel: the 'Alle Neuigkeiten' link is clipped at the bottom on
// desktop".
//
// The regression: the news link added in #179 carried `pt-2` and no matching
// bottom padding. On a phone that is invisible — `min-h-11` forces a 44px box
// and centres the label in it — but `md:min-h-0` takes that floor away from
// `md` up, so the box collapsed onto its line box: 8px of air above the label
// and none below. The descender of "Neuigkeiten" sat on the bottom edge, and
// the hover highlight (which paints that same box) was visibly lopsided.
//
// So the assertions here are measurements of the rendered box, not a class
// list: the space between the link's border box and its label's line box must
// match above and below at desktop widths, while the 44px touch floor — which
// is *not* what was wrong — survives at mobile ones.

import type { Locator, Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expectViewportHealthy } from './helpers/viewport'
import { expect, test } from './fixtures'

/** One notice, so the panel renders in its normal (non-empty) shape. */
const ACTIVE = [
  {
    id: 'e2e-192-active',
    title: { de: 'Wartungsfenster Rechenzentrum', en: 'Maintenance window: data centre' },
    body: { de: 'Der VPN-Zugang ist am Samstag kurzzeitig nicht verfügbar.', en: 'VPN is briefly unavailable.' },
    severity: 'info',
    audience: 'all',
    dismissible: true,
    created_at: '2026-09-14T08:00:00Z',
  },
]

async function stub(page: Page, announcements: unknown[]) {
  await page.route('**/api/announcements', (route) => route.fulfill({ json: { announcements } }))
  await page.route('**/api/announcements/history', (route) => route.fulfill({ json: { announcements: [] } }))
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: /Mitteilungen|Notifications/i }).first().click()
  const panel = page.getByRole('dialog', { name: /^Mitteilungen$|^Notifications$/ })
  await expect(panel).toBeVisible()
  return panel
}

interface RowMetrics {
  /** Air between the row's border box and the first line box of its label. */
  above: number
  below: number
  height: number
  paddingTop: number
  paddingBottom: number
}

/**
 * Measures where the label actually sits inside a row's painted box.
 *
 * The label's *line box* is taken from a Range over the text node rather than
 * from the element rect, so the number reflects what the eye sees — a padding,
 * a border or a line-height change all move it.
 */
function measure(row: Locator, labelSelector: string): Promise<RowMetrics> {
  return row.evaluate((el: HTMLElement, sel: string) => {
    const label = el.querySelector(sel) as HTMLElement
    const box = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(label)
    const text = range.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      above: text.top - box.top,
      below: box.bottom - text.bottom,
      height: box.height,
      paddingTop: parseFloat(cs.paddingTop),
      paddingBottom: parseFloat(cs.paddingBottom),
    }
  }, labelSelector)
}

function newsLink(panel: Locator) {
  return panel.getByRole('link', { name: /Alle Neuigkeiten|All news/ })
}

/** The shared claim: the label is centred in the box that paints behind it. */
async function expectLabelCentred(row: Locator, labelSelector: string, isMobile: boolean) {
  const m = await measure(row, labelSelector)
  expect(
    Math.abs(m.above - m.below),
    `the label sits off-centre in its box: ${m.above.toFixed(1)}px above, ${m.below.toFixed(1)}px below`,
  ).toBeLessThanOrEqual(1)
  // Nothing of the label may reach the edge of the box it is painted in: that
  // is the clipping, and the hover highlight follows the same box.
  expect(m.below, 'the label has no room below it — its descenders touch the edge').toBeGreaterThan(0)
  // The phone touch target is not what was wrong here, and must survive.
  if (isMobile) expect(m.height, 'the phone touch target').toBeGreaterThanOrEqual(44)
  return m
}

test.describe('issue #192 — the news link at the foot of the notification panel', () => {
  test.beforeEach(async ({ page }) => {
    await stub(page, ACTIVE)
    await gotoApp(page)
  })

  test('its label has the same air above and below it', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const panel = await openPanel(page)
    const link = newsLink(panel)
    await expect(link).toBeVisible()

    await expectLabelCentred(link, 'span', isMobile)
    await expectViewportHealthy(page, { isMobile, label: 'notification panel, news link' })
  })

  // The link renders in the empty state too (#179), where it is the panel's
  // only row — and was just as clipped there.
  test('the same holds in the empty state', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stub(page, [])
    await page.reload()
    const panel = await openPanel(page)
    await expect(panel.getByText(/Keine Mitteilungen\.|No announcements\./)).toBeVisible()

    await expectLabelCentred(newsLink(panel), 'span', isMobile)
    await expectViewportHealthy(page, { isMobile, label: 'empty notification panel, news link' })
  })

  // #192 asked whether the asymmetry is a shared idiom or a one-off. The notice
  // rows use `py-2` and are symmetric; this pins that down so the one-off
  // cannot spread to a row later.
  test('the notice rows above it are symmetric as well', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const panel = await openPanel(page)
    const row = panel.getByRole('button', { name: /Wartungsfenster Rechenzentrum/ })
    await expect(row).toBeVisible()

    const m = await measure(row, 'p')
    expect(m.paddingTop, 'the notice row pads equally top and bottom').toBeCloseTo(m.paddingBottom, 1)
    if (isMobile) expect(m.height).toBeGreaterThanOrEqual(44)
  })
})

// The panel is drawn from the same tokens in both themes, but the clipping is
// most visible against the dark surface — and the matrix runs both.
test.describe('issue #192 — in the dark theme', () => {
  test.use({ colorScheme: 'dark' })

  test.beforeEach(async ({ page }) => {
    await stub(page, ACTIVE)
    await gotoApp(page)
  })

  test('the news link is unclipped there too', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const panel = await openPanel(page)
    await expectLabelCentred(newsLink(panel), 'span', isMobile)
    await expectViewportHealthy(page, { isMobile, label: 'dark notification panel, news link' })
  })
})
