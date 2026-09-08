// Service visibility, opt-in flavour (issue #34, docs/specs/service-visibility.md
// §5/§10): toggle → warning → the experimental service appears inline, badged →
// toggle off → it is gone again. At every resolution in the matrix.
//
// The fixture is the seeded "Zettelkasten Labor" (dev/seed.sql), restricted to
// the `experimental` slug that dev/config.e2e.yaml configures as an opt-in
// group; playwright.config.ts starts the binary with that config. It sits alone
// in the "KI-Werkzeuge" category, so the category itself is part of the
// assertion: it exists for a holder and vanishes for everyone else (spec §3).
//
// The toggle is a real server write on the one shared test user, so the flow
// runs under a cross-worker lock (helpers/lock.ts) and always leaves the user
// opted out — the state every other spec assumes.

import type { Page } from '@playwright/test'
import { withCrossWorkerLock } from './helpers/lock'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const SERVICE = /Zettelkasten Labor/
const CATEGORY = 'KI-Werkzeuge'

// Six workers may queue behind the lock; each flow takes a few seconds.
test.setTimeout(120_000)

/** Puts the shared user back into the opted-out state, whatever a failed run left. */
async function optOut(page: Page) {
  const res = await page.request.put('/api/me/visibility', { data: { optin: [] } })
  expect(res.status(), 'reset opt-in state').toBe(200)
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: /Konto-Menü|Account menu/i }).click()
  const menu = page.getByRole('dialog', { name: /Konto|Account/i })
  await expect(menu).toBeVisible()
  return menu
}

test('opting in reveals the experimental service, badged; opting out hides it again', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await withCrossWorkerLock('visibility-optin', async () => {
    await optOut(page)
    try {
      await gotoApp(page, '/?tab=dienste')
      const main = page.getByRole('main')

      // Non-holder: no service, no category pill leaking the group's name.
      await expect(main.getByRole('link', { name: SERVICE })).toHaveCount(0)
      await expect(page.getByRole('button', { name: CATEGORY })).toHaveCount(0)

      // The switch, off; the account menu with it open is a layout state.
      let menu = await openAccountMenu(page)
      const toggle = menu.getByRole('switch', { name: /Experimentell anzeigen|Show Experimental/ })
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await expectViewportHealthy(page, { isMobile, label: 'account menu with visibility switch' })

      // Enabling asks first, with the configured warning — at every width.
      await toggle.click()
      const dialog = page.getByRole('dialog', { name: /Experimentell anzeigen\?|Show Experimental\?/ })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/ohne Vorankündigung verschwinden|disappear at any time/)).toBeVisible()
      await expectViewportHealthy(page, { isMobile, label: 'opt-in warning dialog' })
      await dialog.getByRole('button', { name: /^Anzeigen$|^Show$/ }).click()
      await expect(dialog).toBeHidden()

      // Holder: the service is inline in the normal view, badged with the
      // group's label, and its category is a real filter on a desktop.
      const tile = main.getByRole('link', { name: SERVICE }).first()
      await expect(tile).toBeVisible()
      await expect(tile).toHaveAccessibleName(/\(Experimentell\)/)
      await expect(main.getByText('Experimentell', { exact: true }).first()).toBeVisible()
      if (!isMobile) {
        await expect(page.getByRole('button', { name: CATEGORY })).toBeVisible()
      }
      await expectViewportHealthy(page, { isMobile, label: 'experimental service visible' })

      // Search resolves it too — search is a read surface like any other.
      const search = page.getByRole('searchbox')
      await search.fill('Zettelkasten')
      await expect(main.getByRole('link', { name: SERVICE }).first()).toBeVisible()
      await search.fill('')

      // Turning it off is immediate: no dialog, and the service is gone.
      menu = await openAccountMenu(page)
      const on = menu.getByRole('switch', { name: /Experimentell anzeigen|Show Experimental/ })
      await expect(on).toHaveAttribute('aria-checked', 'true')
      await on.click()
      await expect(page.getByRole('dialog', { name: /anzeigen\?|Show .*\?/ })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(main.getByRole('link', { name: SERVICE })).toHaveCount(0)
      await expect(page.getByRole('button', { name: CATEGORY })).toHaveCount(0)
    } finally {
      await optOut(page)
    }
  })
})

// The server side of the same contract, straight against the API: what a
// non-holder cannot obtain through any read surface, a holder can — and the
// held set is what /api/me reports.
test('the API narrows every read surface to the held set', async ({ page }) => {
  await withCrossWorkerLock('visibility-optin', async () => {
    await optOut(page)
    try {
      const names = async (url: string) => {
        const res = await page.request.get(url)
        expect(res.status(), url).toBe(200)
        const body = (await res.json()) as { services: { name: string }[]; categories?: { slug: string }[] }
        return { services: body.services.map((s) => s.name), categories: body.categories?.map((c) => c.slug) ?? [] }
      }

      let me = await (await page.request.get('/api/me')).json()
      expect(me.visibility.held).toEqual([])
      expect(me.visibility.entries.map((e: { slug: string }) => e.slug)).toEqual(['experimental'])

      let catalog = await names('/api/catalog')
      expect(catalog.services).not.toContain('Zettelkasten Labor')
      expect(catalog.categories).not.toContain('ai-tools')
      expect((await names('/api/search?q=Zettelkasten')).services).toEqual([])

      const put = await page.request.put('/api/me/visibility', { data: { optin: ['experimental'] } })
      expect(put.status()).toBe(200)
      me = await put.json()
      expect(me.visibility.held).toEqual(['experimental'])

      catalog = await names('/api/catalog')
      expect(catalog.services).toContain('Zettelkasten Labor')
      expect(catalog.categories).toContain('ai-tools')
      expect((await names('/api/search?q=Zettelkasten')).services).toContain('Zettelkasten Labor')

      // A slug nobody may self-grant is refused, and the state is unchanged.
      const bad = await page.request.put('/api/me/visibility', { data: { optin: ['it-infra'] } })
      expect(bad.status()).toBe(400)
      expect((await (await page.request.get('/api/me')).json()).visibility.held).toEqual(['experimental'])
    } finally {
      await optOut(page)
    }
  })
})
