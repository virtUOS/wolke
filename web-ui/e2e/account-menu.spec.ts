// Flow 6 of the viewport suite (spec §6): the account menu, open. Also the
// touch-target landmine called out in docs/specs/m2-ux-bug-batch.md §0 — the
// menu rows and the theme/language pills are well under 44px on a phone the
// moment this spec opens the panel, which is exactly what it's here to catch
// (and, in this PR, to fix — see TopBar.tsx).

import type { Locator, Page } from '@playwright/test'
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

/**
 * Asserts that every option pill in `group` sits on one row and renders its
 * label as a single line box — the invariant issue #98 is about.
 *
 * A Range over the button's contents reports one client rect per line box, so
 * `rects.length > 1` is a label broken across lines; comparing the buttons'
 * `offsetTop` catches the other half of the defect, where the labels each fit
 * but the group itself wraps and the odd pill stretches across its own row.
 */
async function expectOptionsOnOneLine(group: Locator, what: string): Promise<void> {
  const measured = await group.evaluate((el) =>
    Array.from(el.querySelectorAll('button')).map((b) => {
      const range = document.createRange()
      range.selectNodeContents(b)
      return {
        text: (b.textContent ?? '').trim(),
        lines: range.getClientRects().length,
        top: Math.round(b.getBoundingClientRect().top),
        clipped: b.scrollWidth > b.clientWidth + 1,
      }
    }),
  )
  expect(measured.length, `${what}: options found`).toBeGreaterThan(1)

  const wrapped = measured.filter((m) => m.lines !== 1)
  expect(wrapped, `${what}: options whose label broke across lines: ${JSON.stringify(wrapped)}`).toEqual([])

  const clipped = measured.filter((m) => m.clipped)
  expect(clipped, `${what}: options clipping their label: ${JSON.stringify(clipped)}`).toEqual([])

  const rows = [...new Set(measured.map((m) => m.top))]
  expect(rows, `${what}: options spread over ${rows.length} rows — ${JSON.stringify(measured)}`).toHaveLength(1)
}

// Issue #98: in German the language group did not fit the panel, so it wrapped
// and "English" stretched alone across a second row. The panel/pill sizing has
// to hold one row per group in either language, at every viewport in the matrix.
test('the theme and language options each stay on one line, de and en', async ({ page }) => {
  await stubPrefs(page)
  await gotoApp(page)

  await page.getByRole('button', { name: /Konto-Menü|Account menu/i }).click()
  // The panel's accessible name is localized, so it has to match either
  // language: the switch below relabels this very dialog.
  const menu = page.getByRole('dialog', { name: /Konto|Account/i })
  await expect(menu).toBeVisible()

  await expectOptionsOnOneLine(menu.getByRole('group', { name: 'Farbschema' }), 'Farbschema (de)')
  await expectOptionsOnOneLine(menu.getByRole('group', { name: 'Sprache' }), 'Sprache (de)')

  // The English labels are a different set of lengths — assert them too, on the
  // same panel width, rather than assuming German is always the worst case.
  await menu.getByRole('group', { name: 'Sprache' }).getByRole('button', { name: 'English' }).click()
  const themeEn = menu.getByRole('group', { name: 'Colour scheme' })
  await expect(themeEn).toBeVisible()
  await expectOptionsOnOneLine(themeEn, 'Colour scheme (en)')
  await expectOptionsOnOneLine(menu.getByRole('group', { name: 'Language' }), 'Language (en)')
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
