// Playwright e2e config — see docs/specs/responsive-viewport-testing.md.
//
// The app under test is the *embedded* Go binary (SPA compiled into the binary),
// not the Vite dev server: what we ship is what we test, so unbuilt CSS or HMR
// wrappers can't hide a layout bug. `make e2e` builds it; the webServer block
// below only starts it.
//
// The viewport matrix is a project per resolution with a FIXED viewport rather
// than a `devices[...]` preset — the numbers are the contract (CLAUDE.md
// "Responsive & viewport discipline"), and fixed numbers keep failures
// reproducible when Playwright's device list changes under us.

import { defineConfig, type PlaywrightTestConfig, type PlaywrightTestOptions } from '@playwright/test'
import { STORAGE_STATE } from './e2e/helpers/session'

/** Port for the binary under test — deliberately not 8080, so a running `make run` is left alone. */
const PORT = Number(process.env.E2E_PORT ?? 8471)
const BASE_URL = `http://localhost:${PORT}`

/** Phones get a real device pixel ratio and touch; see the spec's §3 table. */
const PHONE: Partial<PlaywrightTestOptions> = { isMobile: true, hasTouch: true, deviceScaleFactor: 3 }

interface MatrixEntry {
  name: string
  viewport: { width: number; height: number }
  use: Partial<PlaywrightTestOptions>
}

/** The fixed viewport matrix (mirror of CLAUDE.md — keep the three in sync). */
const MATRIX: MatrixEntry[] = [
  { name: 'mobile-324', viewport: { width: 324, height: 756 }, use: PHONE },
  { name: 'mobile-360', viewport: { width: 360, height: 800 }, use: PHONE },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, use: PHONE },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, use: {} },
  { name: 'desktop-1280', viewport: { width: 1280, height: 720 }, use: {} },
  { name: 'desktop-1920', viewport: { width: 1920, height: 1080 }, use: {} },
]

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts are e2e tests; helpers/rules.test.ts is a Vitest unit test
  // that happens to live next to the helper it covers.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI keeps the HTML report (uploaded as an artifact on failure) plus GitHub
  // annotations; locally the list reporter is enough.
  reporter: (process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['list']]) as PlaywrightTestConfig['reporter'],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    browserName: 'chromium' as const,
    baseURL: BASE_URL,
    // Stabilizes waits and exercises the app's own prefers-reduced-motion path.
    // Lives under contextOptions: it is a browser-context option, not one of the
    // top-level test options.
    contextOptions: { reducedMotion: 'reduce' },
    // German is the shipped language and the source of the long compounds that
    // break layouts; the suite runs in it by default.
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // One login for the whole run (helpers/session.ts).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // No `devices[...]` preset anywhere: the viewport numbers are the contract,
    // and a preset would quietly change them (and the UA) on a Playwright bump.
    ...MATRIX.map(({ name, viewport, use }) => ({
      name,
      dependencies: ['setup'],
      use: {
        ...use,
        viewport,
        storageState: STORAGE_STATE,
      },
    })),
  ],

  webServer: {
    // The repo root is the binary's working directory: BRANDING_DIR and the
    // migrations directory are resolved relative to it.
    cwd: '..',
    command: 'sh -c \'[ -x bin/server ] || { echo "bin/server is missing — run: make build" >&2; exit 1; }; exec ./bin/server\'',
    url: `${BASE_URL}/healthz`,
    // Never reuse: the suite needs the binary running with exactly this env
    // (PUBLIC_URL must match BASE_URL or the CSRF guard and cookies won't match).
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HTTP_ADDR: `:${PORT}`,
      PUBLIC_URL: BASE_URL,
      SESSION_SECRET: 'e2e-not-secret',
      LOG_LEVEL: 'warn',
      BRANDING_DIR: 'branding',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://wolke:devpass@localhost:5432/wolke?sslmode=disable',
      // 127.0.0.1, not localhost: mock-oauth2-server crashes on IPv6 peers.
      OIDC_ISSUER_URL: process.env.OIDC_TEST_ISSUER ?? 'http://127.0.0.1:8455/default',
      OIDC_CLIENT_ID: 'wolke',
      OIDC_CLIENT_SECRET: 'dev-secret',
    },
  },
})
