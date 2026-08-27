// Viewport assertions: overflow, readability and touch targets
// (docs/specs/responsive-viewport-testing.md §5).
//
// One DOM walk in the page collects an ElementProbe per visible element; the
// verdicts and messages come from helpers/rules.ts, in Node, so a regression
// reads as "which element, how far past the edge" instead of `expect(false)`.

import { expect, type Page } from '@playwright/test'
import {
  MIN_TOUCH_TARGET,
  TOLERANCE,
  overflowKind,
  overflowMessage,
  readabilityMessage,
  textNotRendered,
  textTooSmall,
  touchTargetMessage,
  touchTargetTooSmall,
  violationBlock,
  type ElementProbe,
} from './rules'

interface Snapshot {
  /** The CSS viewport width (`documentElement.clientWidth`) — see snapshot(). */
  viewportWidth: number
  documentScrollWidth: number
  probes: ElementProbe[]
}

/** Elements treated as click targets when looking for a padded parent. */
const CLICK_TARGET_SELECTOR = 'a[href], button, [role="button"], label'

/**
 * Walks the document in the browser and returns one probe per visible element.
 *
 * Skipped, per §5.1: non-rendered elements, `aria-hidden` subtrees (they are not
 * part of the perceivable UI), `.sr-only` elements (deliberately 1px), and
 * `position: fixed` elements parked entirely off-canvas — that is how a closed
 * drawer or the assistant panel waits, and it is not an overflow.
 */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(
    ({ clickTargetSelector, minTouchTarget }) => {
      const INTERACTIVE = [
        'a[href]',
        'button',
        '[role="button"]',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ')
      // The CSS viewport width — NOT window.innerWidth: under Chromium's mobile
      // emulation the layout viewport widens to fit overflowing content, so
      // innerWidth reports 364 on a 324px phone and every overflow check would
      // silently pass. documentElement.clientWidth is what `100vw` means.
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth

      const SKIP_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'BR'])

      const flat = (r: DOMRect) => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      })

      const label = (el: Element) => {
        const id = el.id ? `#${el.id}` : ''
        const cls =
          typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
            : ''
        return `${el.tagName.toLowerCase()}${id}${cls}`
      }

      const directText = (el: Element) => {
        let out = ''
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? ''
        }
        return out.trim()
      }

      const snippet = (el: Element) => {
        const raw = directText(el) || (el.textContent ?? '').trim()
        const one = raw.replace(/\s+/g, ' ')
        return one.length > 60 ? `${one.slice(0, 59)}…` : one
      }

      // The hit area is the element's own box, unless it is undersized and sits
      // alone inside a padded click target (the icon-inside-a-button case) — then
      // the parent is what the finger actually hits.
      const hitRect = (el: Element, own: DOMRect) => {
        if (own.width >= minTouchTarget && own.height >= minTouchTarget) return own
        const parent = el.parentElement?.closest(clickTargetSelector)
        if (parent && parent !== el && parent.querySelectorAll(INTERACTIVE).length === 1) {
          return parent.getBoundingClientRect()
        }
        return own
      }

      const probes = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (SKIP_TAGS.has(el.tagName)) continue
        if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue
        if (el.closest('[aria-hidden="true"]')) continue
        if (el.classList.contains('sr-only')) continue

        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const offCanvas = rect.right <= 0 || rect.left >= viewportWidth
        if (style.position === 'fixed' && offCanvas) continue

        probes.push({
          selector: label(el),
          text: snippet(el),
          rect: flat(rect),
          fontSize: parseFloat(style.fontSize) || 0,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          position: style.position,
          hasDirectText: directText(el) !== '',
          interactive: el.matches(INTERACTIVE),
          hitRect: flat(hitRect(el, rect)),
          smallTargetOk: el.hasAttribute('data-e2e-small-target-ok'),
        })
      }

      return {
        viewportWidth,
        documentScrollWidth: document.scrollingElement?.scrollWidth ?? document.body.scrollWidth,
        probes,
      }
    },
    { clickTargetSelector: CLICK_TARGET_SELECTOR, minTouchTarget: MIN_TOUCH_TARGET },
  )
}

/** §5.1 — no horizontal document scroll, and nothing sticking past an edge. */
export async function expectNoHorizontalOverflow(page: Page, label = ''): Promise<void> {
  const snap = await snapshot(page)
  const where = label ? ` [${label}]` : ''

  expect(
    snap.documentScrollWidth,
    `the document scrolls horizontally${where}: scrollWidth ${snap.documentScrollWidth} > viewport width ${snap.viewportWidth}`,
  ).toBeLessThanOrEqual(snap.viewportWidth + TOLERANCE)

  const lines: string[] = []
  for (const p of snap.probes) {
    const kind = overflowKind(p, snap.viewportWidth)
    if (kind) lines.push(overflowMessage(p, kind, snap.viewportWidth))
  }
  expect(lines, violationBlock(`horizontal overflow at ${snap.viewportWidth}px${where}`, lines)).toEqual([])
}

/** §5.2 — every visible text run is at least 12px and actually rendered. */
export async function expectReadableText(page: Page, label = ''): Promise<void> {
  const snap = await snapshot(page)
  const where = label ? ` [${label}]` : ''
  const lines = snap.probes
    .filter((p) => textTooSmall(p) || textNotRendered(p))
    .map((p) => readabilityMessage(p))
  expect(lines, violationBlock(`unreadable text${where}`, lines)).toEqual([])
}

/** §5.3 — mobile only: every interactive element is at least 44×44px. */
export async function expectTouchTargets(page: Page, label = ''): Promise<void> {
  const snap = await snapshot(page)
  const where = label ? ` [${label}]` : ''
  const lines = snap.probes.filter((p) => touchTargetTooSmall(p)).map((p) => touchTargetMessage(p))
  expect(lines, violationBlock(`touch targets below ${MIN_TOUCH_TARGET}px${where}`, lines)).toEqual([])
}

/** The three checks, addressable by name so a spec can narrow the auto-guard. */
export type ViewportCheck = 'overflow' | 'readability' | 'touch-targets'

const ALL_CHECKS: ViewportCheck[] = ['overflow', 'readability', 'touch-targets']

/**
 * Runs every check that applies to the current project. Specs call this after
 * opening an intermediate state (menu, dialog, expanded tile); the final state
 * of each test is checked automatically by the fixture in ../fixtures.ts.
 */
export async function expectViewportHealthy(
  page: Page,
  opts: { isMobile?: boolean; label?: string; checks?: ViewportCheck[] } = {},
): Promise<void> {
  const label = opts.label ?? ''
  const checks = opts.checks ?? ALL_CHECKS
  if (checks.includes('overflow')) await expectNoHorizontalOverflow(page, label)
  if (checks.includes('readability')) await expectReadableText(page, label)
  // Touch targets are a phone concern only: a mouse hits a 20px link fine.
  if (opts.isMobile && checks.includes('touch-targets')) await expectTouchTargets(page, label)
}
