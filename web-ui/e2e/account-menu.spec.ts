// Flow 6 of the viewport suite (spec §6): the account menu, open. Also the
// touch-target landmine called out in docs/specs/m2-ux-bug-batch.md §0 — the
// menu rows and the theme/language pills are well under 44px on a phone the
// moment this spec opens the panel, which is exactly what it's here to catch
// (and, in this PR, to fix — see TopBar.tsx).

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

// The mock IdP maps every project onto the same test user, and prefs mutations
// persist server-side — so a real PATCH here would leak the language/theme
// pick across the other five viewport projects running in parallel. Fulfil
// the request from the client instead of sending it: the UI still gets a
// realistic, fully-shaped Me back (merged onto whatever /api/me already has),
// but nothing is written server-side for the other workers to inherit.
async function stubPrefs(page: Page) {
  await page.route('**/api/me/prefs', async (route) => {
    const patch = route.request().postDataJSON() as Record<string, unknown>
    const current = await (await page.request.get('/api/me')).json()
    await route.fulfill({ json: { ...current, ...patch } })
  })
}

test('the account menu opens, survives a language switch, and closes cleanly', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true

  await stubPrefs(page)
  await gotoApp(page)

  const trigger = page.getByRole('button', { name: /Konto-Menü|Account menu/i })
  await trigger.click()
  const menu = page.getByRole('dialog', { name: /Konto|Account/i })
  await expect(menu).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'account menu open' })

  const languageGroup = menu.getByRole('group', { name: /Sprache|Language/i })
  await languageGroup.getByRole('button', { name: 'English' }).click()
  await expect(menu.getByRole('group', { name: 'Colour scheme' })).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'account menu open, language switched to en' })

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('the theme group switches themes without closing the menu', async ({ page }) => {
  await stubPrefs(page)
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /Konto-Menü|Account menu/i })
  await trigger.click()
  const menu = page.getByRole('dialog', { name: /Konto|Account/i })

  const themeGroup = menu.getByRole('group', { name: 'Farbschema' })
  const dark = themeGroup.getByRole('button', { name: 'Dunkel' })
  await dark.click()
  await expect(dark).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/dark/)

  const auto = themeGroup.getByRole('button', { name: 'Automatisch' })
  await auto.click()
  await expect(auto).toHaveAttribute('aria-pressed', 'true')
  await expect(dark).toHaveAttribute('aria-pressed', 'false')
})
