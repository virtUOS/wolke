// Regression spec for https://github.com/virtUOS/wolke/issues/115
// "The notification history is difficult to read" — history rows used to render
// a truncated title and a line-clamped body with no way to read the rest. Per
// the issue's decision comment, rows stay compact and a tap opens the full
// notice in the shared Dialog primitive.
//
// The seeded environment has no history announcements, so the response is
// stubbed with a deliberately long, multi-paragraph body — the readability
// case the issue is actually about — rather than depending on real data.

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const LONG_BODY =
  'Am kommenden Wochenende wird die zentrale Authentifizierung für mehrere Stunden nicht verfügbar sein, ' +
  'da eine grundlegende Aktualisierung der Identitätsverwaltungsinfrastruktur ansteht.\n\n' +
  'Bitte speichern Sie laufende Arbeiten rechtzeitig vorher ab. Nach Abschluss der Wartungsarbeiten ' +
  'stehen alle Dienste wie gewohnt zur Verfügung. Bei Rückfragen wenden Sie sich an den IT-Support.'

const HISTORY_ITEM = {
  id: 'e2e-history-1',
  title: { de: 'Wartungsfenster Identitätsmanagement', en: 'Maintenance window: identity management' },
  body: { de: LONG_BODY, en: LONG_BODY },
  severity: 'warning',
  audience: 'all',
  dismissible: true,
  starts_at: '2026-01-10T20:00:00Z',
  ends_at: '2026-01-11T04:00:00Z',
  created_at: '2026-01-11T04:00:00Z',
}

async function stubHistory(page: Page) {
  await page.route('**/api/announcements/history', async (route) => {
    await route.fulfill({ json: { announcements: [HISTORY_ITEM] } })
  })
}

async function openHistoryRow(page: Page) {
  await page.getByRole('button', { name: /Mitteilungen|Notifications/i }).click()
  const row = page.getByRole('button', { name: /Wartungsfenster Identitätsmanagement/ })
  await expect(row).toBeVisible()
  await row.click()
}

test.describe('issue #115 — notification history opens in a dialog', () => {
  test.beforeEach(async ({ page }) => {
    await stubHistory(page)
    await gotoApp(page)
  })

  test('a history row opens the full notice, labelled by its title', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true

    await openHistoryRow(page)
    const dialog = page.getByRole('dialog', { name: 'Wartungsfenster Identitätsmanagement' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Am kommenden Wochenende/)).toBeVisible()
    await expect(dialog.getByText(/Bitte speichern Sie laufende Arbeiten/)).toBeVisible()
    await expect(dialog.getByText(/Gültig vom .* bis .*/)).toBeVisible()

    // Explicit check on the open dialog, in addition to the fixture's
    // auto-guard on this test's final state (it ends here, dialog open).
    await expectViewportHealthy(page, { isMobile, label: 'notification history dialog open' })
  })

  test('Escape closes the dialog and returns focus to the row', async ({ page }) => {
    await openHistoryRow(page)
    const dialog = page.getByRole('dialog', { name: 'Wartungsfenster Identitätsmanagement' })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole('button', { name: /Wartungsfenster Identitätsmanagement/ }),
    ).toBeFocused()
  })

  test('clicking outside the dialog closes it', async ({ page }) => {
    await openHistoryRow(page)
    const dialog = page.getByRole('dialog', { name: 'Wartungsfenster Identitätsmanagement' })
    await expect(dialog).toBeVisible()

    // The overlay sits behind the dialog content, covering the rest of the viewport.
    await page.mouse.click(2, 2)
    await expect(dialog).toBeHidden()
  })
})
