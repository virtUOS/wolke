// The extended `test` every spec imports.
//
// Its one job (docs/specs/responsive-viewport-testing.md §5.4): run the viewport
// assertions automatically after each test, against whatever state the test
// ended in, so "every tested state is overflow-checked" is the default rather
// than a per-test chore. Intermediate states (menu open, dialog open) are only
// reached mid-test, so specs still call the helpers explicitly there.

import { test as base, expect } from '@playwright/test'
import { type ViewportCheck, expectViewportHealthy } from './helpers/viewport'

interface ViewportOptions {
  /**
   * Which checks the auto-guard runs. Defaults to every check that applies to
   * the project (touch targets only on phones).
   *
   * Narrow it — `test.use({ viewportChecks: ['overflow'] })` — in a spec that
   * reproduces one specific defect, so it can go green with that defect's fix
   * instead of waiting on every other layout bug at the same width. Never
   * narrow it in a normal flow spec: that is how regressions get in.
   */
  viewportChecks: ViewportCheck[] | undefined
}

export const test = base.extend<ViewportOptions & { viewportGuard: void }>({
  viewportChecks: [undefined, { option: true }],

  viewportGuard: [
    async ({ page, viewportChecks }, use, testInfo) => {
      await use()
      // Don't pile layout complaints on top of an already-failing test — the
      // original failure is the useful one, and a half-rendered page after a
      // timeout would report violations that don't exist in a passing run.
      if (testInfo.status !== testInfo.expectedStatus) return
      if (page.isClosed()) return
      await expectViewportHealthy(page, {
        isMobile: testInfo.project.use.isMobile === true,
        checks: viewportChecks,
        label: 'final state',
      })
    },
    { auto: true },
  ],
})

export { expect }
