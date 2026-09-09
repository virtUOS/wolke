// Issue #139 (docs/specs/empty-facets.md): a filter is offered only when it
// selects something. The pill strip is therefore a layout state with two
// shapes — facets present and facets absent — and both have to survive the
// whole viewport matrix, because the strip is what wraps first at 324px and the
// German compounds ("In Wartung", "Identitätsmanagement") are what wrap it.
//
// Like admin-categories.spec.ts, the catalog is served client-side with
// page.route rather than written through the API: the two states differ only in
// which services carry a tag, and six viewport projects share one logged-in
// session and one dev database, so tagging a real service `wartung` six times
// concurrently would be a flake generator. The server half of the rule (an
// empty category never reaches the client at all) is pinned by the Go tests in
// internal/catalog; what this spec covers is what the strip renders from the
// catalog it is given.

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

interface SeedService {
  id: string
  name: string
  categories: string[]
  tag?: 'beta' | 'wartung'
}

/** Real German compounds, not lorem ipsum — they are what the 324px strip has to survive. */
const CATEGORIES = [
  { slug: 'learning', label: { de: 'Lernmanagement', en: 'Learning' }, sort: 10 },
  { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 20 },
  { slug: 'identity', label: { de: 'Identitätsmanagement', en: 'Identity management' }, sort: 30 },
]

const PLAIN: SeedService[] = [
  { id: 's1', name: 'Stud.IP', categories: ['learning'] },
  { id: 's2', name: 'MyShare', categories: ['data'] },
  { id: 's3', name: 'Identitätsmanagement', categories: ['identity'] },
]

const TAGGED: SeedService[] = [
  ...PLAIN,
  { id: 's4', name: 'Webmail', categories: ['data'], tag: 'wartung' },
  { id: 's5', name: 'Zettelkasten Labor', categories: ['learning'], tag: 'beta' },
]

/**
 * Serves the narrowed catalog, and — when `showBeta` — a /api/me that has the
 * pref on, so the Beta facet's second condition is satisfied too. Categories
 * are always populated here: an empty one is dropped server-side and never
 * reaches this route at all.
 */
async function stubCatalog(page: Page, services: SeedService[], showBeta = false): Promise<void> {
  await page.route('**/api/catalog', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      json: {
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          description: { de: `${s.name} für alle.`, en: `${s.name} for everyone.` },
          service_url: `https://${s.id}.example.edu`,
          icon: 'shield',
          categories: s.categories,
          doc_only: false,
          ...(s.tag ? { tag: s.tag } : {}),
        })),
        categories: CATEGORIES,
      },
    })
  })
  if (!showBeta) return
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), show_beta: true } })
  })
}

function filterStrip(page: Page) {
  return page.getByRole('group', { name: /Kategorien filtern|Filter by category/i })
}

test.describe('issue #139 — the pill strip only offers facets that select something', () => {
  test('with nothing tagged, neither "In Wartung" nor "Beta" is offered', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stubCatalog(page, PLAIN, true) // the pref is on and STILL no Beta pill
    await gotoApp(page, '/?tab=dienste')
    await expect(page.getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()

    if (isMobile) {
      // No filter controls at all on a phone — discovery is search-only.
      await expect(filterStrip(page)).toHaveCount(0)
      await expectViewportHealthy(page, { isMobile, label: 'dashboard without a pill strip (mobile)' })
      return
    }

    const strip = filterStrip(page)
    await expect(strip.getByRole('button', { name: /In Wartung|In maintenance/ })).toHaveCount(0)
    await expect(strip.getByRole('button', { name: /^Beta$/ })).toHaveCount(0)
    // What is left is "Alle" plus the three populated categories, and nothing else.
    await expect(strip.getByRole('button')).toHaveCount(4)
    await expectViewportHealthy(page, { isMobile, label: 'pill strip without facets' })
  })

  test('with a maintenance and a beta service, both facets are offered and filter', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stubCatalog(page, TAGGED, true)
    await gotoApp(page, '/?tab=dienste')
    await expect(page.getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()

    if (isMobile) {
      await expect(filterStrip(page)).toHaveCount(0)
      await expectViewportHealthy(page, { isMobile, label: 'tagged catalog without a pill strip (mobile)' })
      return
    }

    const strip = filterStrip(page)
    const maintenance = strip.getByRole('button', { name: /In Wartung|In maintenance/ })
    const beta = strip.getByRole('button', { name: /^Beta$/ })
    await expect(maintenance).toBeVisible()
    await expect(beta).toBeVisible()
    // Two facets on top of "Alle" and the three categories — the widest the
    // strip ever gets, which is the state worth checking for overflow.
    await expect(strip.getByRole('button')).toHaveCount(6)
    await expectViewportHealthy(page, { isMobile, label: 'pill strip with both facets' })

    // Each facet is a real view, not decoration.
    await maintenance.click()
    await expect(page).toHaveURL(/filter=wartung/)
    const main = page.getByRole('main')
    await expect(main.getByRole('link', { name: /Webmail/ })).toHaveCount(1)
    await expect(main.getByRole('link', { name: /Stud\.IP/ })).toHaveCount(0)
    await expectViewportHealthy(page, { isMobile, label: 'maintenance facet active' })

    await beta.click()
    await expect(page).toHaveURL(/filter=beta/)
    await expect(main.getByRole('link', { name: /Zettelkasten Labor/ })).toHaveCount(1)
    await expectViewportHealthy(page, { isMobile, label: 'beta facet active' })
  })

  test('a ?cat= link to a category the catalog no longer carries degrades to "Alle"', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    // An emptied category is simply absent from /api/catalog after #139, which
    // is exactly the case the existing stale-filter guard was written for.
    await stubCatalog(page, PLAIN)
    await gotoApp(page, '/?cat=verwaltung')

    await expect(page).not.toHaveURL(/cat=/)
    await expect(page.getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()
    if (!isMobile) {
      await expect(page.getByRole('heading', { level: 2, name: /Alle Dienste|All services/ })).toBeVisible()
      await expect(filterStrip(page).getByRole('button', { name: /^Alle$|^All$/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    await expectViewportHealthy(page, { isMobile, label: 'stale category link degraded to Alle' })
  })

  test('a ?filter=wartung link with nothing in maintenance degrades to "Alle"', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stubCatalog(page, PLAIN)
    await gotoApp(page, '/?filter=wartung')

    await expect(page).not.toHaveURL(/filter=/)
    if (!isMobile) {
      await expect(page.getByRole('heading', { level: 2, name: /Alle Dienste|All services/ })).toBeVisible()
      await expect(filterStrip(page).getByRole('button', { name: /In Wartung|In maintenance/ })).toHaveCount(0)
    }
    await expectViewportHealthy(page, { isMobile, label: 'stale maintenance link degraded to Alle' })
  })
})
