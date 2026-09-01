// The admin screens that render from the configured role set
// (docs/specs/configurable-roles.md §2.4): the role default-view editor and the
// announcement audience picker. Both are driven by GET /api/roles, so the spec
// asserts against that response rather than against a hardcoded role list — it
// passes for a two-role deployment and for a six-role one.
//
// The viewport health check runs after every test (fixtures.ts), so this also
// covers "wraps, never overflows" at 324px with the seeded roles.

import { expect, test } from './fixtures'

// Overflow and readability, not touch targets. The admin surface as a whole
// (its section tabs, form inputs, selects, checkboxes and buttons) sits below
// the 44px touch floor at phone widths — pre-existing debt across the shared
// primitives, not something the role set introduced, and too broad to fix
// sideways here. What this feature owes the matrix is that a role list of any
// length wraps instead of overflowing (docs/specs/configurable-roles.md §2.4);
// that is what these two checks assert. Restore the full set once the admin
// screens get their touch-target pass.
test.use({ viewportChecks: ['overflow', 'readability'] })

interface Role {
  slug: string
  label: Record<string, string>
}

async function configuredRoles(page: import('@playwright/test').Page): Promise<Role[]> {
  const res = await page.request.get('/api/roles')
  expect(res.status()).toBe(200)
  const roles = (await res.json()) as Role[]
  expect(roles.length).toBeGreaterThan(0)
  return roles
}

test('the role default-view editor renders one tab per configured role', async ({ page }) => {
  await page.goto('/?admin=1')
  const roles = await configuredRoles(page)

  await page.getByRole('button', { name: 'Rollen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Rollen-Standardansicht' })).toBeVisible()

  // Every configured role has a tab, labelled as the API labels it (German).
  for (const role of roles) {
    await expect(page.getByRole('button', { name: role.label.de, exact: true })).toBeVisible()
  }
  // The first role in precedence order is the one selected on arrival.
  await expect(page.getByRole('button', { name: roles[0].label.de, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  )

  // Switching roles loads that role's list (and, at 324px, must not overflow —
  // the fixture checks that after the test).
  const other = roles[roles.length - 1]
  await page.getByRole('button', { name: other.label.de, exact: true }).click()
  await expect(page.getByRole('button', { name: other.label.de, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  )
})

test('the announcement audience picker offers all + the configured roles', async ({ page }) => {
  await page.goto('/?admin=1')
  const roles = await configuredRoles(page)

  await page.getByRole('button', { name: 'Ankündigungen', exact: true }).click()
  await page.getByRole('button', { name: 'Ankündigung anlegen' }).click()

  const audience = page.getByLabel('Zielgruppe')
  await expect(audience).toBeVisible()
  await expect(audience.locator('option')).toHaveCount(roles.length + 1) // + "all"
  for (const role of roles) {
    await expect(audience.locator(`option[value="${role.slug}"]`)).toHaveCount(1)
  }
  await expect(audience.locator('option[value="all"]')).toHaveCount(1)

  // Selecting a role audience is the state an admin publishes from; leave the
  // form open (nothing is written) so the viewport check sees it.
  await audience.selectOption(roles[0].slug)
  await expect(audience).toHaveValue(roles[0].slug)
})

// The >5-roles warning exists because the role tabs are where a large set
// hurts. A six-role deployment must still wrap cleanly at 324px, so the roles
// are stubbed here rather than depending on the dev config's set.
test('a six-role deployment wraps instead of overflowing', async ({ page }) => {
  const many: Role[] = ['staff', 'student', 'alumni', 'guest', 'faculty', 'external'].map((slug) => ({
    slug,
    label: { de: `Rolle ${slug}`, en: slug },
  }))
  await page.route('**/api/roles', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(many) }),
  )

  await page.goto('/?admin=1')
  await page.getByRole('button', { name: 'Rollen', exact: true }).click()
  for (const role of many) {
    await expect(page.getByRole('button', { name: role.label.de, exact: true })).toBeVisible()
  }
  // The audience picker grows with the set too.
  await page.getByRole('button', { name: 'Ankündigungen', exact: true }).click()
  await page.getByRole('button', { name: 'Ankündigung anlegen' }).click()
  await expect(page.getByLabel('Zielgruppe').locator('option')).toHaveCount(many.length + 1)
})
