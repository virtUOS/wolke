// Setup project: log in through the mock IdP once and save the session cookie
// for every viewport project to reuse (playwright.config.ts `dependencies`).

import { test as setup } from '@playwright/test'
import { STORAGE_STATE, login } from './helpers/session'

setup('authenticate via the mock IdP', async ({ page }) => {
  await login(page)
  await page.context().storageState({ path: STORAGE_STATE })
})
