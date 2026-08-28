// Authenticated session for the e2e suite.
//
// The mock IdP runs with `interactiveLogin: false` and maps client_id `wolke`
// to a student who is also in `dashboard-admins` (dev/mock-oidc-config.json), so
// a plain navigation to `/` walks the whole OIDC redirect chain unattended and
// lands on the dashboard with admin rights — one identity covers the user and
// the admin screens. auth.setup.ts does this once and stores the session cookie;
// every project reuses it via `storageState`.

import path from 'node:path'
import { expect, type Page } from '@playwright/test'

/** Where the shared, logged-in browser state is cached (gitignored). */
export const STORAGE_STATE = path.join(import.meta.dirname, '..', '.auth', 'user.json')

/** Navigates to the app, following the IdP redirect chain, and waits for the dashboard. */
export async function login(page: Page): Promise<void> {
  await page.goto('/')
  // The salutation is the dashboard's <h1> and only renders once /api/me and
  // /api/branding have resolved — i.e. once the session exists.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}
