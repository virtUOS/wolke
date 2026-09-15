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
