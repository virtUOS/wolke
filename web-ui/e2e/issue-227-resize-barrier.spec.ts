// Issue #227 — the harness's own resize barrier.
//
// Not a test of the app: a test of `resizeViewport()`, which every viewport
// assertion taken after a resize depends on. The defect it covers is a probe
// read *during* the style recalc that a breakpoint crossing triggers, judged by
// the guard against the destination's contract — seen as
// `button.h-11.w-11.rounded-full "TS" has a 26×26px hit area, below the
// 44×44px floor` on an element whose classes say 44.
//
// The property asserted is the barrier's whole contract: the moment it lets go,
// the elements the crossing resizes already have the size this layout gives
// them. Neither number is written down here — both are learned from the page,
// so the test states the property rather than the day's design.
//
// Crossings run back to back, with nothing between them that would let the
// engine catch up. That is what the specs actually do (resize, then assert),
// and it is the condition the insufficient barrier misses under.
//
// How often it misses depends on how busy the machine is — the same probe on
// the same tree measured 3/40 crossings on an idle box and 28/40 on a loaded
// one, which is why the defect "comes and goes". So the count below is sized
// for the quietest case worth catching, which is not the original defect
// (~40% per crossing, caught by anything) but a barrier left one frame short:
// which missed 1–8 of every 40 crossings when measured, so forty reads catch
// it most of the time per project, on each of the three phone projects. A
// one-frame barrier is not a hypothetical: it is what the first cut of
// resizeViewport() was written as, and regenerating the miss table against the
// shipped helper is what caught it.

import type { Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { resizeViewport } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The account button: `h-11 w-11 … md:h-[26px] md:w-[26px]` (TopBar.tsx), so
 *  its box is driven by the `md:` query a crossing re-evaluates — and it is the
 *  element the guard actually caught mid-recalc. */
const AVATAR = 'button.h-11.w-11.rounded-full'

const DESKTOP_STOP = { width: 1280, height: 720 }
const CROSSINGS = 20

const avatarWidth = (page: Page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`${sel} is gone — this test no longer measures what it claims to`)
    return el.getBoundingClientRect().width
  }, AVATAR)

/** The width this layout eventually gives the avatar, read after letting the
 *  page go idle — the reference the barrier is then held to. */
async function settledWidth(page: Page, size: { width: number; height: number }): Promise<number> {
  await resizeViewport(page, size)
  let last = -1
  await expect
    .poll(async () => {
      const w = await avatarWidth(page)
      const stable = w === last
      last = w
      return stable
    })
    .toBe(true)
  return last
}

test('a resize does not return until the crossing has reached the elements it resizes', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  test.skip(!isMobile, 'the phone projects are the ones that cross into a stricter contract')
  const start = testInfo.project.use.viewport!

  await gotoApp(page)
  await expect(page.locator(AVATAR)).toHaveCount(1)

  const onDesktop = await settledWidth(page, DESKTOP_STOP)
  const onPhone = await settledWidth(page, start)
  expect(onDesktop, 'the two layouts give the avatar different sizes, or this proves nothing').not.toBe(onPhone)
  // The contract the guard enforces here, and the one the early reads kept
  // failing. If this fails, the selector above went stale, not the barrier.
  expect(onPhone, 'the avatar is a touch target on the phone side').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)

  const early: string[] = []
  for (let i = 0; i < CROSSINGS; i++) {
    await resizeViewport(page, DESKTOP_STOP)
    const there = await avatarWidth(page)
    if (there !== onDesktop) early.push(`#${i} →${DESKTOP_STOP.width}px: read ${there}, expected ${onDesktop}`)

    await resizeViewport(page, start)
    const back = await avatarWidth(page)
    if (back !== onPhone) early.push(`#${i} →${start.width}px: read ${back}, expected ${onPhone}`)
  }

  expect(
    early,
    `resizeViewport() returned before the recalc reached the avatar on ${early.length} of ${CROSSINGS * 2} crossings:\n  ${early.join('\n  ')}`,
  ).toEqual([])
})
