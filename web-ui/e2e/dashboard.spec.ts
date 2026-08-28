// Flow 1 of the viewport suite (spec §6): the dashboard as it lands, at every
// resolution in the matrix. The layout assertions are not written out here — the
// fixture in fixtures.ts runs the full viewport health check after every test.

import { expect, test } from './fixtures'

test('the favorites tab renders the user’s services', async ({ page }) => {
  await page.goto('/')
  // Chrome: the top bar landmark, and the salutation as the page's <h1>.
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The seeded student role defaults (dev/seed.sql) arrive as favorites.
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()
  await expect(main.getByRole('link', { name: /Identitätsmanagement/ }).first()).toBeVisible()
  // The longest seeded German compound — the layout must absorb it, not clip it.
  await expect(main.getByText('Persönlicher Netzspeicher der Universität.')).toBeVisible()
})

test('the services tab renders the whole catalog', async ({ page }) => {
  await page.goto('/?tab=dienste')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /BigBlueButton/ }).first()).toBeVisible()
  await expect(main.getByRole('link', { name: /VPN/ }).first()).toBeVisible()
})

test('search narrows the catalog', async ({ page }) => {
  await page.goto('/?tab=dienste')
  const search = page.getByRole('searchbox')
  await expect(search).toBeVisible()
  await search.fill('Netzspeicher')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /MyShare/ }).first()).toBeVisible()
  await expect(main.getByRole('link', { name: /BigBlueButton/ })).toHaveCount(0)
})

test('the tab navigation switches between the two sections', async ({ page }) => {
  await page.goto('/?tab=dienste')
  const nav = page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })
  await nav.getByRole('button', { name: 'Favoriten' }).click()
  await expect(nav.getByRole('button', { name: 'Favoriten' })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/$/)
})
