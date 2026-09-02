// Regression spec for https://github.com/virtUOS/wolke/issues/115 (admin half,
// per the decision comment): the admin announcements screen used to wire
// Edit/Delete to only the current announcement, even though GET
// /api/admin/announcements (announce.AdminList, limit 100) already returns
// every retained (non-erased) one. This spec asserts the full list — not just
// the current row — renders with working per-row actions.
//
// The admin write endpoints share one rate-limit bucket keyed by session
// token (internal/server/security.go, 60/min) — and the whole viewport matrix
// shares one logged-in session (helpers/session.ts: "one login for the whole
// run"). Six projects each hitting real create/delete endpoints at once blows
// through that budget immediately (confirmed: a real run of this spec hit
// 429s within the first couple of seconds). So, like account-menu.spec.ts's
// prefs stub, this seeds and mutates its rows client-side via page.route
// instead of writing through the real API — it exercises the same UI flows
// (list, edit, erase-with-confirm) without the cross-project collision.

import type { Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

interface SeedRow {
  id: string
  title: { de: string; en: string }
  body: { de: string; en: string }
  severity: string
  audience: string
  dismissible: boolean
  starts_at?: string
  ends_at?: string
  created_at: string
}

// Newest first, as AdminList returns them. Only the newest (`row-c`) has no
// ends_at, so it is the one genuinely active row; the older two are retired
// by the singleton invariant (internal/service/announce.go) regardless of
// their own window.
function seedRows(): SeedRow[] {
  return [
    {
      id: 'row-c',
      title: { de: 'Aktuelle Wartungsankündigung', en: 'Current maintenance notice' },
      body: { de: 'Text C.', en: 'Text C.' },
      severity: 'critical',
      audience: 'all',
      dismissible: false,
      created_at: '2026-03-03T09:00:00Z',
    },
    {
      id: 'row-b',
      title: { de: 'Vorherige Ankündigung B', en: 'Previous announcement B' },
      body: { de: 'Text B.', en: 'Text B.' },
      severity: 'warning',
      audience: 'all',
      dismissible: true,
      ends_at: '2026-03-03T09:00:00Z',
      created_at: '2026-02-01T09:00:00Z',
    },
    {
      id: 'row-a',
      title: { de: 'Älteste Ankündigung A', en: 'Oldest announcement A' },
      body: { de: 'Text A.', en: 'Text A.' },
      severity: 'info',
      audience: 'all',
      dismissible: true,
      ends_at: '2026-02-01T09:00:00Z',
      created_at: '2026-01-01T09:00:00Z',
    },
  ]
}

/** Serves the admin announcements list client-side, and applies PATCH/DELETE
 *  to the in-memory rows so the UI's own optimistic refetch sees them change —
 *  no real write reaches the backend or its shared rate-limit bucket. */
async function stubAdminAnnouncements(page: Page, rows: SeedRow[]): Promise<void> {
  await page.route('**/api/admin/announcements', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { announcements: rows } })
  })
  await page.route('**/api/admin/announcements/*', async (route) => {
    const id = route.request().url().split('/').pop()
    const method = route.request().method()
    if (method === 'DELETE') {
      rows = rows.filter((r) => r.id !== id)
      await route.fulfill({ status: 204 })
      return
    }
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Partial<SeedRow>
      const idx = rows.findIndex((r) => r.id === id)
      if (idx >= 0) rows[idx] = { ...rows[idx], ...patch }
      await route.fulfill({ json: rows[idx] })
      return
    }
    await route.fallback()
  })
}

async function gotoAnnouncements(page: Page): Promise<void> {
  await gotoApp(page, '/?admin=1')
  await page.getByRole('button', { name: /Ankündigungen|Announcements/i, exact: true }).click()
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
}

test.describe('issue #115 — the admin sees and manages every retained announcement', () => {
  test('every retained row renders, newest first, each with a status badge and working actions', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const rows = seedRows()
    await stubAdminAnnouncements(page, rows)
    await gotoAnnouncements(page)

    const items = page.getByRole('listitem')
    await expect(items).toHaveCount(3)

    // Newest first, and the singleton-active row is flagged distinctly from
    // the two it superseded.
    await expect(items.nth(0)).toContainText('Aktuelle Wartungsankündigung')
    await expect(items.nth(0).getByText('Aktiv')).toBeVisible()
    await expect(items.nth(1)).toContainText('Vorherige Ankündigung B')
    await expect(items.nth(1).getByText('Abgelöst')).toBeVisible()
    await expect(items.nth(2)).toContainText('Älteste Ankündigung A')
    await expect(items.nth(2).getByText('Abgelöst')).toBeVisible()

    // Edit opens the retired row's own data, not the active one's (#100
    // stale-audience behavior lives in the same form and is covered
    // separately in admin-roles.spec.ts).
    await items.nth(2).getByRole('button', { name: 'Bearbeiten' }).click()
    await expect(page.getByLabel('Titel (de)')).toHaveValue('Älteste Ankündigung A')
    await expectViewportHealthy(page, { isMobile, label: 'admin – editing a retired announcement' })
    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible()

    // Row actions meet the touch floor at phone widths (issue #99 convention).
    if (isMobile) {
      for (let i = 0; i < 3; i++) {
        for (const label of ['Bearbeiten', 'Löschen']) {
          const box = await items.nth(i).getByRole('button', { name: label }).boundingBox()
          expect(box, `${label} on row ${i}`).not.toBeNull()
          expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        }
      }
    }
  })

  test('erasing a retired row confirms with its own title and "history", then removes only it', async ({ page }) => {
    const rows = seedRows()
    await stubAdminAnnouncements(page, rows)
    await gotoAnnouncements(page)

    const items = page.getByRole('listitem')
    await items.filter({ hasText: 'Vorherige Ankündigung B' }).getByRole('button', { name: 'Löschen' }).click()

    const dialog = page.getByRole('dialog', { name: 'Ankündigung entfernen?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Vorherige Ankündigung B/)).toBeVisible()
    await expect(dialog.getByText(/Verlauf aller Nutzer/)).toBeVisible()

    await dialog.getByRole('button', { name: 'Löschen' }).click()
    await expect(dialog).toBeHidden()

    await expect(items).toHaveCount(2)
    await expect(page.getByText('Vorherige Ankündigung B')).toHaveCount(0)
    // The active row and the other retired row are untouched.
    await expect(page.getByText('Aktuelle Wartungsankündigung')).toBeVisible()
    await expect(page.getByText('Älteste Ankündigung A')).toBeVisible()
  })
})
