// Flow 3 of the viewport suite (spec §6): search, results open, and the
// zero-result empty state — at every viewport. Also issue #27: launching a
// result by a plain click clears the search and drops the user back on the
// view they were on, since the service opens in a new tab (issue #26) and a
// stale search is what's left behind otherwise.

import { expectViewportHealthy } from './helpers/viewport'
import { expect, test } from './fixtures'

test('typing a query opens the results panel, and launching a result clears the search', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true

  await page.goto('/?tab=dienste')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const search = page.getByRole('searchbox')
  await search.fill('Netzspeicher')
  const result = page.getByRole('main').getByRole('link', { name: /MyShare/ }).first()
  await expect(result).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'search results open' })

  const [popup] = await Promise.all([page.context().waitForEvent('page'), result.click()])
  await popup.close()

  await expect(search).toHaveValue('')
  // Back on the view the search was opened from — the whole catalog, not a
  // narrowed result set.
  await expect(page.getByRole('main').getByRole('link', { name: /BigBlueButton/ }).first()).toBeVisible()
})

test('Ctrl-clicking a result leaves the search open', async ({ page }) => {
  await page.goto('/?tab=dienste')
  const search = page.getByRole('searchbox')
  await search.fill('Netzspeicher')
  const result = page.getByRole('main').getByRole('link', { name: /MyShare/ }).first()
  await expect(result).toBeVisible()

  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    result.click({ modifiers: ['Control'] }),
  ])
  await popup.close()

  await expect(search).toHaveValue('Netzspeicher')
})

test('a zero-result query renders the empty state', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true

  await page.goto('/?tab=dienste')
  const search = page.getByRole('searchbox')
  await search.fill('xyznonexistentservicexyz')

  await expect(page.getByText(/Keine Dienste für|No services found for/)).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'zero-result search' })
})
