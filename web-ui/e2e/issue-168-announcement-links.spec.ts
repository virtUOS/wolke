// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/168
// "Announcements: render URLs and [label](url) as clickable links".
//
// The three things the issue calls out as easy to get wrong, measured in a real
// browser at every matrix resolution:
//   1. the bell history row renders NO anchor — it is inside a <button>;
//   2. a pasted 120-character URL must not overflow at 324×756;
//   3. a non-allowlisted scheme renders as literal text, never as an href.
// Plus the keyboard contract: the link is tabbable and focus-visible in both
// the banner and the history dialog.
//
// Seeded via page.route, not through the admin API: the admin write endpoints
// share one rate-limit bucket keyed by session token and the whole matrix
// shares one logged-in session, so six projects writing at once hit 429s
// (the #115 lesson — see admin-announcements.spec.ts).

import type { Locator, Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** Exactly 120 characters — the pasted-URL case from the issue. */
const LONG_URL = `https://status.example.edu/wartung/${'a'.repeat(85)}`

/** One body carrying every case: labelled link, bare URL, a 120-char bare URL,
 *  mailto, and a denied scheme that must stay literal. */
const BODY =
  'Details auf der [Statusseite der Universität](https://status.example.edu/plan) ' +
  `oder direkt unter ${LONG_URL} — ` +
  'Rückfragen an mailto:support@example.edu. Nicht erlaubt: [Klick](javascript:alert(1))'

const ACTIVE = {
  id: 'e2e-168-active',
  title: { de: 'Wartungsfenster Identitätsmanagement', en: 'Maintenance window: identity management' },
  body: { de: BODY, en: BODY },
  severity: 'warning',
  audience: 'all',
  dismissible: true,
  created_at: '2026-03-03T09:00:00Z',
}

const PAST = {
  ...ACTIVE,
  id: 'e2e-168-past',
  title: { de: 'Behobene Netzstörung', en: 'Resolved network outage' },
  severity: 'info',
  starts_at: '2026-01-10T20:00:00Z',
  ends_at: '2026-01-11T04:00:00Z',
  created_at: '2026-01-11T04:00:00Z',
}

async function stubAnnouncements(page: Page): Promise<void> {
  await page.route('**/api/announcements', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { announcements: [ACTIVE] } })
  })
  await page.route('**/api/announcements/history', async (route) => {
    await route.fulfill({ json: { announcements: [PAST] } })
  })
}

/** The link contract inside one region: both forms link, mailto opens in place,
 *  and nothing on a denied scheme ever became an href. */
async function expectLinkContract(scope: Locator): Promise<void> {
  const labelled = scope.getByRole('link', { name: 'Statusseite der Universität' })
  await expect(labelled).toHaveAttribute('href', 'https://status.example.edu/plan')
  await expect(labelled).toHaveAttribute('target', '_blank')
  await expect(labelled).toHaveAttribute('rel', 'noopener noreferrer')

  const bare = scope.getByRole('link', { name: LONG_URL })
  await expect(bare).toHaveAttribute('href', LONG_URL)
  await expect(bare).toHaveAttribute('target', '_blank')

  const mail = scope.getByRole('link', { name: 'mailto:support@example.edu' })
  await expect(mail).toHaveAttribute('href', 'mailto:support@example.edu')
  await expect(mail).not.toHaveAttribute('target', '_blank')

  // The denied scheme is literal text, and no anchor in this region carries it.
  await expect(scope.getByText('[Klick](javascript:alert(1))')).toBeVisible()
  const links = await scope.getByRole('link').all()
  expect(links).toHaveLength(3)
  for (const link of links) {
    const href = ((await link.getAttribute('href')) ?? '').toLowerCase()
    expect(href).not.toContain('javascript:')
    expect(href).not.toContain('data:')
  }
}

/** Every anchor in the region meets the 44px touch floor on a phone. */
async function expectTouchableLinks(scope: Locator, label: string): Promise<void> {
  const links = await scope.getByRole('link').all()
  expect(links.length).toBeGreaterThan(0)
  for (const link of links) {
    const box = await link.boundingBox()
    expect(box, `${label}: anchor has no box`).not.toBeNull()
    expect(box!.height, `${label}: anchor height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  }
}

/**
 * Tabs forward until `target` holds focus, then asserts the browser considers it
 * keyboard-focused (`:focus-visible`) — i.e. the ring is actually shown.
 */
async function expectReachableByKeyboard(page: Page, target: Locator, label: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(target, `${label}: not reachable by Tab`).toBeFocused()
  expect(await target.evaluate((el) => el.matches(':focus-visible')), `${label}: no focus ring`).toBe(true)
}

test.describe('issue #168 — announcement bodies render clickable links', () => {
  test.beforeEach(async ({ page }) => {
    await stubAnnouncements(page)
  })

  test('the active banner links both forms and fits the viewport', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)

    const banner = page.getByRole('region', { name: /Ankündigungen|Announcements/ })
    await expect(banner).toBeVisible()
    await expectLinkContract(banner)
    if (isMobile) await expectTouchableLinks(banner, 'banner')

    // The 120-character URL is the overflow case the issue names.
    await expectViewportHealthy(page, { isMobile, label: 'dashboard with a linked banner' })
  })

  test('the banner link is tabbable and focus-visible', async ({ page }) => {
    await gotoApp(page)
    const banner = page.getByRole('region', { name: /Ankündigungen|Announcements/ })
    await expectReachableByKeyboard(page, banner.getByRole('link', { name: LONG_URL }), 'banner link')
  })

  test('the history row renders no anchor, and its dialog does', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)

    await page.getByRole('button', { name: /Mitteilungen|Notifications/ }).click()
    const row = page.getByRole('button', { name: /Behobene Netzstörung/ })
    await expect(row).toBeVisible()

    // A link inside a <button> is invalid HTML and an a11y bug: the row shows
    // the body's text projection instead.
    expect(await row.locator('a').count(), 'anchor inside the history row').toBe(0)
    await expect(row).toContainText('Statusseite der Universität')
    await expect(row).not.toContainText('](https://status.example.edu/plan)')
    await expectViewportHealthy(page, { isMobile, label: 'notification panel with a linked body' })

    await row.click()
    const dialog = page.getByRole('dialog', { name: 'Behobene Netzstörung' })
    await expect(dialog).toBeVisible()
    await expectLinkContract(dialog)
    if (isMobile) await expectTouchableLinks(dialog, 'history dialog')
    await expectViewportHealthy(page, { isMobile, label: 'history dialog with links' })

    await expectReachableByKeyboard(page, dialog.getByRole('link', { name: LONG_URL }), 'dialog link')
  })

  test('the admin body preview renders the parsed links and stays viewport-clean', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page, '/?admin=1')
    await page.getByRole('button', { name: /Ankündigungen|Announcements/i, exact: true }).click()
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible()

    const create = page.getByRole('button', { name: /Ankündigung anlegen|Create announcement/ })
    await expect(create).toBeEnabled()
    await create.click()

    // The hint names the two accepted forms.
    await expect(page.getByText(/\[Text\]\(https:\/\/…\)/).first()).toBeVisible()

    await page.getByLabel(/^Text \(de\)/).fill(BODY)
    const preview = page.getByRole('group', { name: /Vorschau \(de\)|Preview \(de\)/ })
    await expect(preview).toBeVisible()
    await expectLinkContract(preview)
    if (isMobile) await expectTouchableLinks(preview, 'admin preview')

    // A new layout state: it gets the full matrix like any other screen.
    await expectViewportHealthy(page, { isMobile, label: 'admin announcement form with body preview' })
  })
})
