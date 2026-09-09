// Issue #144: single sign-out must complete in Chromium. Logout is a form POST
// that /auth/logout answers with a 302 to the IdP's end-session endpoint, and
// Chrome — unlike Firefox — enforces CSP `form-action` against redirect
// targets. With `form-action 'self'` alone the hop to the IdP is silently
// blocked: wolke's session dies, the IdP's survives, and the next login on
// that browser resumes the previous user (#143). Playwright drives Chromium,
// so this is one of the few auth bugs the suite's browser reproduces exactly.
//
// The spec logs in on its own: it destroys the session it uses, and the
// storageState the other projects share must survive it.

import { login } from './helpers/session'
import { expect, test } from './fixtures'

test.use({ storageState: { cookies: [], origins: [] } })

test('logging out walks the redirect chain through the IdP and back to wolke', async ({ page, baseURL }) => {
  await login(page)
  const before = (await page.context().cookies()).find((c) => c.name === 'sh_session')
  expect(before, 'a session cookie exists after login').toBeTruthy()

  // The top-level navigation that the CSP bug blocks. Registered before the
  // click so a fast redirect chain cannot slip past the listener.
  const endSession = page.waitForRequest(
    (req) => req.isNavigationRequest() && req.url().includes('/endsession'),
    { timeout: 15_000 },
  )
  await page.getByRole('button', { name: /Konto-Menü|Account menu/i }).click()
  await page.getByRole('button', { name: /Abmelden|Sign out/i }).click()

  const req = await endSession
  const dest = new URL(req.url())
  expect(dest.origin, 'the end-session hop is cross-origin (the IdP), not wolke').not.toBe(new URL(baseURL!).origin)
  expect(dest.searchParams.get('post_logout_redirect_uri')).toBe(baseURL)

  // The IdP redirects back to post_logout_redirect_uri. The mock IdP is
  // non-interactive, so the SPA re-authenticates silently from there — the
  // observable end state is a *new* session, not the one we logged out of.
  await page.waitForURL((u) => u.origin === new URL(baseURL!).origin)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const after = (await page.context().cookies()).find((c) => c.name === 'sh_session')
  expect(after?.value, 'the logged-out session was not reused').not.toBe(before!.value)
})
