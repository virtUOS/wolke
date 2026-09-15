// Regression spec for https://github.com/virtUOS/wolke/issues/179
// "Notification center: render active announcements like the rest".
//
// The regression: an active notice was a full Alert with its whole body
// expanded, so one long announcement filled the panel and pushed the history out
// of sight — worst at 324px, the narrowest supported width. Both groups are now
// the same compact row, and the whole list stays reachable at every viewport.
//
// The seeded environment has no announcements, so both endpoints are stubbed
// with the pathological content the issue is about.
//
// The second half covers the panel's optional "Alle Neuigkeiten" link
// (branding.news_url). The suite's config file sets it (dev/config.e2e.yaml), so
// the link exercises the real config -> /api/branding -> panel wiring; the
// hidden case patches the branding response instead.

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const LONG_BODY =
  'Am kommenden Wochenende wird die zentrale Authentifizierung für mehrere Stunden nicht ' +
  'verfügbar sein, da eine grundlegende Aktualisierung der Identitätsverwaltungsinfrastruktur ' +
  'ansteht. Betroffen sind alle Dienste, die sich über das zentrale Anmeldeverfahren ' +
  'authentifizieren, also insbesondere Stud.IP, die Lernplattform, das Webmail-Angebot und der ' +
  'VPN-Zugang.\n\n' +
  'Bitte speichern Sie laufende Arbeiten rechtzeitig vorher ab und melden Sie sich aus allen ' +
  'Diensten ab. Nach Abschluss der Wartungsarbeiten stehen alle Dienste wie gewohnt zur ' +
  'Verfügung. Bei Rückfragen wenden Sie sich bitte an den IT-Support des Rechenzentrums.'

const ACTIVE = {
  id: 'e2e-active-1',
  title: { de: 'Wartungsfenster Identitätsmanagement', en: 'Maintenance window: identity management' },
  body: { de: LONG_BODY, en: LONG_BODY },
  severity: 'warning',
  audience: 'all',
  dismissible: true,
  starts_at: '2026-09-12T20:00:00Z',
  ends_at: '2026-09-30T04:00:00Z',
  created_at: '2026-09-12T20:00:00Z',
}

// Several history entries, so "the whole list stays reachable" is a real claim.
const HISTORY = [1, 2, 3, 4, 5].map((n) => ({
  id: `e2e-history-${n}`,
  title: { de: `Vergangene Störungsmeldung ${n}`, en: `Past incident ${n}` },
  body: { de: `Die Störung ${n} im Netzbetrieb wurde behoben.`, en: `Incident ${n} was resolved.` },
  severity: 'info',
  audience: 'all',
  dismissible: true,
  starts_at: '2026-08-01T08:00:00Z',
  ends_at: '2026-08-02T08:00:00Z',
  created_at: `2026-08-0${n}T08:00:00Z`,
}))

async function stubAnnouncements(page: Page) {
  await page.route('**/api/announcements', async (route) => {
    await route.fulfill({ json: { announcements: [ACTIVE] } })
  })
  await page.route('**/api/announcements/history', async (route) => {
    await route.fulfill({ json: { announcements: HISTORY } })
  })
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: /Mitteilungen|Notifications/i }).first().click()
  const panel = page.getByRole('dialog', { name: /^Mitteilungen$|^Notifications$/ })
  await expect(panel).toBeVisible()
  return panel
}

test.describe('issue #179 — the notification panel at every viewport', () => {
  test.beforeEach(async ({ page }) => {
    await stubAnnouncements(page)
    await gotoApp(page)
  })

  test('a long active notice is a compact row, and the whole list stays reachable', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const panel = await openPanel(page)

    // Both groups are labelled and present.
    await expect(panel.getByRole('heading', { name: /Aktuell|Current/ })).toBeVisible()
    await expect(panel.getByRole('heading', { name: /Verlauf|History/ })).toBeVisible()

    // The active notice is a row: its body is the clamped preview, and its
    // rendered height is nowhere near the expanded body's.
    const activeRow = panel.getByRole('button', { name: /Wartungsfenster Identitätsmanagement/ })
    await expect(activeRow).toBeVisible()
    const box = await activeRow.boundingBox()
    expect(box, 'the active row must be laid out').not.toBeNull()
    expect(box!.height).toBeLessThan(120)

    // The panel itself must not overflow the viewport at any width — the
    // regression this issue is about is worst at 324px.
    await expectViewportHealthy(page, { isMobile, label: 'notification panel open' })

    // Every entry is reachable: the last history row scrolls into view inside
    // the panel rather than being pushed out of the panel entirely.
    const lastRow = panel.getByRole('button', { name: /Vergangene Störungsmeldung 5/ })
    await lastRow.scrollIntoViewIfNeeded()
    await expect(lastRow).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'notification panel scrolled to the last entry' })
  })

  test('the active row opens the full notice in the shared dialog', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: /Wartungsfenster Identitätsmanagement/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Wartungsfenster Identitätsmanagement' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Am kommenden Wochenende/)).toBeVisible()
    await expect(dialog.getByText(/Bitte speichern Sie laufende Arbeiten/)).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'active notice dialog open' })
  })

  // Dismissal is the banner's job and only the banner's (settled in #179).
  test('the panel offers no dismiss control, on a row or in the dialog', async ({ page }) => {
    const dismissLabel = /Ankündigung schließen|Dismiss announcement/i
    // The dashboard banner still carries its own ✕ — that path is untouched.
    await expect(page.getByRole('region', { name: /Ankündigungen|Announcements/ }).getByRole('button', { name: dismissLabel })).toHaveCount(1)

    const panel = await openPanel(page)
    await expect(panel.getByRole('button', { name: dismissLabel })).toHaveCount(0)

    await panel.getByRole('button', { name: /Wartungsfenster Identitätsmanagement/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Wartungsfenster Identitätsmanagement' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: dismissLabel })).toHaveCount(0)
  })
})

const NEWS_URL = 'https://news.example.edu/aktuelles'

test.describe('issue #179 — the "all news" link', () => {
  test.beforeEach(async ({ page }) => {
    await stubAnnouncements(page)
  })

  test('is the panel\u2019s last element, opening the configured news site in a new tab', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)
    const panel = await openPanel(page)

    const link = panel.getByRole('link', { name: /Alle Neuigkeiten|All news/ })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', NEWS_URL)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    // Last element: below the history group, and still inside the panel.
    const linkBox = (await link.boundingBox())!
    const lastRowBox = (await panel.getByRole('button', { name: /Vergangene Störungsmeldung 5/ }).boundingBox())!
    expect(linkBox.y).toBeGreaterThan(lastRowBox.y)
    if (isMobile) expect(linkBox.height).toBeGreaterThanOrEqual(44)

    await expectViewportHealthy(page, { isMobile, label: 'notification panel with the news link' })
  })

  // The empty state used to short-circuit the whole panel body — the one case
  // where a user most wants somewhere to go.
  test('renders in the empty state too', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await page.route('**/api/announcements', (route) => route.fulfill({ json: { announcements: [] } }))
    await page.route('**/api/announcements/history', (route) => route.fulfill({ json: { announcements: [] } }))
    await gotoApp(page)
    const panel = await openPanel(page)

    await expect(panel.getByText(/Keine Mitteilungen\.|No announcements\./)).toBeVisible()
    await expect(panel.getByRole('link', { name: /Alle Neuigkeiten|All news/ })).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'empty notification panel with the news link' })
  })

  // Hidden entirely when unconfigured: the branding response is patched to drop it.
  test('is absent when news_url is not configured', async ({ page }) => {
    await page.route('**/api/branding', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...(await res.json()), news_url: '' } })
    })
    await gotoApp(page)
    const panel = await openPanel(page)
    await expect(panel.getByRole('link', { name: /Alle Neuigkeiten|All news/ })).toHaveCount(0)
  })

  // The panel is a role="dialog" with a Tab trap; the link must be inside it and
  // reachable by keyboard.
  test('is reachable by keyboard inside the panel\u2019s focus trap', async ({ page }) => {
    await gotoApp(page)
    const panel = await openPanel(page)
    const link = panel.getByRole('link', { name: /Alle Neuigkeiten|All news/ })

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      // Tab never leaves the panel — it is a role="dialog" with a trap.
      await expect(panel.locator(':focus')).toHaveCount(1)
      if (await link.evaluate((el) => el === document.activeElement)) break
    }
    await expect(link).toBeFocused()
  })
})
