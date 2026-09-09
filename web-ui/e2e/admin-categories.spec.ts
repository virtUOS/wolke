// The category management flows (issue #130): edit, guarded delete, and ▲/▼
// reordering, at every viewport in the matrix.
//
// Like admin-announcements.spec.ts, this seeds and mutates its rows client-side
// via page.route rather than writing through the real API. Two reasons, both
// still true here:
//   - the admin write endpoints share one rate-limit bucket keyed by session
//     token (internal/server/security.go, 60/min) and the whole viewport matrix
//     shares one logged-in session, so six projects hitting real writes at once
//     blows the budget;
//   - the reorder is a *whole-list* write over shared state — six projects
//     rearranging the one dev database's categories concurrently is a flake
//     generator, and the server-side contract is covered by the Go integration
//     tests (internal/server/admin_integration_test.go).
//
// The refusal path (409 with the blocking count) is served by the stub with the
// exact body the service layer produces.

import type { Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

interface SeedCategory {
  slug: string
  label: { de: string; en: string }
  sort: number
}

// Real German compounds, not lorem ipsum: "Identitätsmanagement" beside four
// controls is what the 324px floor actually has to survive.
function seedCategories(): SeedCategory[] {
  return [
    { slug: 'lernmanagement', label: { de: 'Lernmanagement', en: 'Learning' }, sort: 10 },
    { slug: 'identitaetsmanagement', label: { de: 'Identitätsmanagement', en: 'Identity management' }, sort: 20 },
    { slug: 'netz-und-daten', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 30 },
  ]
}

/** The 409 the guarded delete answers with, verbatim from categoryInUseMessage. */
const IN_USE_DETAIL = '2 services still use this category: Stud.IP, Webmail. Reassign them first.'

interface StubOptions {
  /** Slugs whose delete is refused with the in-use 409. */
  blocked?: string[]
  /** Collects the bodies of the writes the UI sent, in order. */
  writes: Array<{ method: string; url: string; body: unknown }>
}

/**
 * Serves the categories client-side and applies the category writes to the
 * in-memory list, so the UI's own refetch sees them change. Services are served
 * empty: this spec is the categories section, and an empty catalog keeps the
 * fixture honest about which list the assertions are reading.
 *
 * Both endpoints are stubbed: the admin screens read the unnarrowed
 * GET /api/admin/categories (docs/specs/service-visibility.md §5), and
 * /api/catalog still feeds the dashboard behind it.
 */
async function stubCategories(page: Page, rows: SeedCategory[], opts: StubOptions): Promise<void> {
  await page.route('**/api/catalog', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { services: [], categories: rows } })
  })
  await page.route('**/api/admin/categories', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { categories: rows } })
  })
  await page.route('**/api/admin/categories/order', async (route) => {
    const req = route.request()
    if (req.method() !== 'PUT') return route.fallback()
    const body = req.postDataJSON() as { slugs: string[] }
    opts.writes.push({ method: 'PUT', url: req.url(), body })
    // Renumber in place, exactly as SetCategoryOrder does.
    rows.sort((a, b) => body.slugs.indexOf(a.slug) - body.slugs.indexOf(b.slug))
    rows.forEach((r, i) => (r.sort = i * 10))
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/admin/categories/*', async (route) => {
    const req = route.request()
    const slug = decodeURIComponent(req.url().split('/').pop() ?? '')
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as { slug: string; label: { de: string; en: string } }
      opts.writes.push({ method: 'PATCH', url: req.url(), body })
      const row = rows.find((r) => r.slug === slug)
      if (row) {
        row.slug = body.slug
        row.label = body.label
      }
      await route.fulfill({ json: row })
      return
    }
    if (req.method() === 'DELETE') {
      opts.writes.push({ method: 'DELETE', url: req.url(), body: null })
      if (opts.blocked?.includes(slug)) {
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          json: { code: 'conflict', detail: IN_USE_DETAIL, status: 409 },
        })
        return
      }
      const i = rows.findIndex((r) => r.slug === slug)
      if (i >= 0) rows.splice(i, 1)
      await route.fulfill({ status: 204 })
      return
    }
    await route.fallback()
  })
}

async function gotoCategories(page: Page): Promise<void> {
  await gotoApp(page, '/?admin=1')
  await page
    .getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i })
    .getByRole('button', { name: 'Kategorien', exact: true })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Kategorien' })).toBeVisible()
}

test.describe('issue #130 — the admin edits, deletes and reorders categories', () => {
  test('every row renders with its label, slug and four working actions', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    const rows = page.getByRole('listitem')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Lernmanagement')
    await expect(rows.nth(0)).toContainText('lernmanagement')
    await expect(rows.nth(1)).toContainText('Identitätsmanagement')

    // Every row action is a real touch target at phone widths — the four
    // controls the section gained are the densest new cluster on the admin
    // surface (issue #101 convention).
    if (isMobile) {
      for (let i = 0; i < 3; i++) {
        for (const name of [/Nach oben/, /Nach unten/, /^Bearbeiten$/, /^Löschen$/]) {
          const button = rows.nth(i).getByRole('button', { name })
          const box = await button.boundingBox()
          expect(box, `${name} on row ${i}`).not.toBeNull()
          expect(box!.height, `${name} on row ${i} is tappable`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
        }
      }
    }
    expect(writes, 'rendering the list writes nothing').toEqual([])
  })

  test('editing a row prefills it, saves the slug and both labels, and returns to the list', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    await page.getByRole('listitem').nth(1).getByRole('button', { name: 'Bearbeiten' }).click()

    // The form carries the row's values, and focus is in it.
    await expect(page.getByLabel('Slug')).toHaveValue('identitaetsmanagement')
    await expect(page.getByLabel('Slug')).toBeFocused()
    await expect(page.getByLabel('Label (de)')).toHaveValue('Identitätsmanagement')
    await expect(page.getByLabel('Label (en)')).toHaveValue('Identity management')
    await expectViewportHealthy(page, { isMobile, label: 'admin – category edit form' })

    await page.getByLabel('Label (de)').fill('Identitätsverwaltung')
    await page.getByLabel('Slug').fill('identitaetsverwaltung')
    await page.getByRole('button', { name: 'Kategorie speichern' }).click()

    await expect(page.getByRole('button', { name: 'Kategorie speichern' })).toBeHidden()
    await expect(page.getByRole('listitem').nth(1)).toContainText('Identitätsverwaltung')
    await expect(page.getByRole('listitem').nth(1)).toContainText('identitaetsverwaltung')
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('PATCH')
    expect(writes[0].body).toEqual({
      slug: 'identitaetsverwaltung',
      label: { de: 'Identitätsverwaltung', en: 'Identity management' },
      // Public, and stays public: this deployment configures a group, and the
      // row carried none (docs/specs/service-visibility.md §2.2).
      visibility: '',
    })
  })

  test('a malformed slug blocks the save before it is sent', async ({ page }) => {
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    await page.getByRole('listitem').first().getByRole('button', { name: 'Bearbeiten' }).click()
    await page.getByLabel('Slug').fill('Foo Bar!!')

    await expect(page.getByLabel('Slug')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText(/nur Kleinbuchstaben/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kategorie speichern' })).toBeDisabled()
    expect(writes).toEqual([])
  })

  test('deleting an unused category confirms first, then removes only it', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    await page.getByRole('listitem').nth(2).getByRole('button', { name: 'Löschen' }).click()

    const dialog = page.getByRole('dialog', { name: 'Kategorie entfernen?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Netz & Daten/)).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – category delete dialog' })

    // Escape dismisses without writing.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(writes).toEqual([])

    await page.getByRole('listitem').nth(2).getByRole('button', { name: 'Löschen' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Löschen' }).click()

    await expect(dialog).toBeHidden()
    const left = page.getByRole('listitem')
    await expect(left).toHaveCount(2)
    await expect(page.getByText('Netz & Daten')).toHaveCount(0)
    await expect(left.nth(0)).toContainText('Lernmanagement')
    await expect(left.nth(1)).toContainText('Identitätsmanagement')
    expect(writes.map((w) => w.method)).toEqual(['DELETE'])
  })

  test('a category services still use is refused with a readable message, and stays', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes, blocked: ['lernmanagement'] })
    await gotoCategories(page)

    await page.getByRole('listitem').first().getByRole('button', { name: 'Löschen' }).click()
    await page.getByRole('dialog', { name: 'Kategorie entfernen?' }).getByRole('button', { name: 'Löschen' }).click()

    // The blocking count and the service names, not a bare status code.
    const alert = page.getByRole('alert')
    await expect(alert).toHaveText(IN_USE_DETAIL)
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('listitem')).toHaveCount(3)
    await expect(page.getByRole('listitem').first()).toContainText('Lernmanagement')
    // The refusal is a normal part of the screen, so it has to lay out like one.
    await expectViewportHealthy(page, { isMobile, label: 'admin – category delete refused' })
  })

  test('▲/▼ reorders the list and writes the whole order', async ({ page }) => {
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    const rows = page.getByRole('listitem')
    // The ends are pinned.
    await expect(rows.nth(0).getByRole('button', { name: /Nach oben/ })).toBeDisabled()
    await expect(rows.nth(2).getByRole('button', { name: /Nach unten/ })).toBeDisabled()

    await rows.nth(2).getByRole('button', { name: /Nach oben/ }).click()

    await expect(rows.nth(1)).toContainText('Netz & Daten')
    await expect(rows.nth(2)).toContainText('Identitätsmanagement')
    // The position numbers are the feedback a button reorder gives, so they have
    // to follow the move.
    await expect(rows.nth(1)).toContainText('2.')
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('PUT')
    expect(writes[0].body).toEqual({ slugs: ['lernmanagement', 'netz-und-daten', 'identitaetsmanagement'] })

    // Moving back down restores the original order and is a second whole-list
    // write — idempotent by shape, not by special-casing.
    await rows.nth(1).getByRole('button', { name: /Nach unten/ }).click()
    await expect(rows.nth(2)).toContainText('Netz & Daten')
    expect(writes).toHaveLength(2)
    expect(writes[1].body).toEqual({ slugs: ['lernmanagement', 'identitaetsmanagement', 'netz-und-daten'] })
  })

  test('the reorder is keyboard-operable and announces where the row landed', async ({ page }) => {
    const writes: StubOptions['writes'] = []
    await stubCategories(page, seedCategories(), { writes })
    await gotoCategories(page)

    const down = page.getByRole('listitem').first().getByRole('button', { name: /Nach unten/ })
    await down.focus()
    await expect(down).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('listitem').nth(1)).toContainText('Lernmanagement')
    // The polite live region carries the new position (issue #35: empty at rest,
    // one message per move).
    await expect(page.getByRole('status')).toHaveText(/Lernmanagement an Position 2 von 3/)
    expect(writes).toHaveLength(1)
  })
})
