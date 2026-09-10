// Regression for issue #156, at the layer that actually failed: the server.
//
// SPAHandler used to answer any unknown path outside api/ with index.html, so a
// hashed chunk the deployed build no longer contained came back 200 text/html.
// The browser cannot parse HTML as an ES module, and the page blanked. The
// #150 spec stubs that 404 client-side with page.route; this one lets the
// request reach the real binary and asserts what it answers.
//
// The second test replays the production shape end to end without a stub on
// the failing request: a bundle that references a chunk name the server does
// not have. The bundle is rewritten once, in the browser, to point at a bogus
// workbox-window chunk (imported via Vite's preload helper on every load, so it
// needs no beta pref and no cross-worker lock); the chunk request itself hits
// the server. A real 404 fires vite:preloadError, lib/pwa-update reloads once,
// the second load gets the untouched bundle, and the page comes up.

import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const STALE_CHUNK = 'workbox-window.prod.es5-STALE0000.js'

test('a missing asset is a 404, not the shell', async ({ page }) => {
  await gotoApp(page)

  const missing = await page.request.get('/assets/does-not-exist.js')
  expect(missing.status(), 'missing hashed asset').toBe(404)
  expect(missing.headers()['content-type'] ?? '', 'a module request must never get HTML').not.toMatch(/^text\/html/)
  expect(await missing.text()).not.toContain('<div id="root">')

  const dotted = await page.request.get('/some/deep/file.png')
  expect(dotted.status(), 'missing file with an extension outside assets/').toBe(404)

  const api = await page.request.get('/api/nope')
  expect(api.status(), 'unknown API path stays a 404').toBe(404)

  const route = await page.request.get('/favorites')
  expect(route.status(), 'client route still gets the shell').toBe(200)
  expect(route.headers()['content-type']).toMatch(/^text\/html/)
  expect(route.headers()['cache-control'], 'shell keeps #152 no-store').toBe('no-store')
})

test('a stale chunk reference self-heals through the real server', async ({ page }) => {
  // Reloads once, so give the flow room at six-worker load.
  test.setTimeout(60_000)

  // Rewrite the main bundle exactly once: the first load is the stale client,
  // the reload must get what the server really has.
  let rewrites = 0
  await page.route('**/assets/index-*.js', async (route) => {
    if (rewrites > 0) return route.fallback()
    const res = await route.fetch()
    const body = await res.text()
    const rewritten = body.replace(/workbox-window\.prod\.es5-[\w-]+\.js/g, STALE_CHUNK)
    expect(rewritten, 'the bundle references the workbox-window chunk').not.toBe(body)
    rewrites++
    await route.fulfill({ response: res, body: rewritten })
  })

  // The stale chunk request is NOT stubbed: whatever the server answers is
  // what the browser sees, which is the property under test.
  let staleStatus = 0
  let staleContentType = ''
  page.on('response', (res) => {
    if (res.url().endsWith(STALE_CHUNK)) {
      staleStatus = res.status()
      staleContentType = res.headers()['content-type'] ?? ''
    }
  })
  let navigations = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++
  })

  await gotoApp(page)

  await expect.poll(() => staleStatus, { message: 'stale chunk answered by the server' }).toBe(404)
  expect(staleContentType, 'never HTML for a module request').not.toMatch(/^text\/html/)
  await expect.poll(() => navigations, { message: 'goto plus exactly one self-heal reload' }).toBe(2)
  await page.waitForTimeout(1000)
  expect(navigations, 'no reload loop').toBe(2)
  expect(rewrites, 'the reload fetched the bundle again').toBe(1)

  // The healed page is a dashboard on the current build.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  expect(
    await page.evaluate(() => sessionStorage.getItem('wolke:stale-shell-reload')),
    'the one reload is recorded, so a repeat failure could not loop',
  ).toBe('1')
})
