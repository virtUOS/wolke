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
  type OverflowKind,
} from './rules'

interface Snapshot {
  /** The CSS viewport width (`documentElement.clientWidth`) — see snapshot(). */
  viewportWidth: number
  documentScrollWidth: number
  probes: ElementProbe[]
}

/** Elements treated as click targets when looking for a padded parent. */
const CLICK_TARGET_SELECTOR = 'a[href], button, [role="button"], label'

/** The attribute snapshot() tags each probed element with, so a flagged
 *  probe's fallback text (see resolveFallbackText) can find it again. */
const PROBE_IDX_ATTR = 'data-e2e-probe-idx'

/**
 * Walks the document in the browser and returns one probe per visible element.
 *
 * Skipped, per §5.1: non-rendered elements, `aria-hidden` subtrees (they are not
 * part of the perceivable UI), `.sr-only` elements (deliberately 1px), and
 * `position: fixed` elements parked entirely off-canvas — that is how a closed
 * drawer or the assistant panel waits, and it is not an overflow.
 *
 * `text` holds only an element's own direct text, capped — resolving the
 * whole-subtree fallback for every element would be an O(n²) walk this close
 * to the document root. A violation that needs the fallback resolves it
 * lazily afterwards, for just its own (usually few) flagged elements — see
 * resolveFallbackText.
 */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(
    ({ clickTargetSelector, minTouchTarget, idxAttr }) => {
      const dom = window.__e2eDomWalk!
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

      const directSnippet = (raw: string) => {
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

      const probes: ElementProbe[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (SKIP_TAGS.has(el.tagName)) continue
        if (!dom.isVisible(el)) continue
        if (el.closest('[aria-hidden="true"]')) continue
        if (el.classList.contains('sr-only')) continue

        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const offCanvas = rect.right <= 0 || rect.left >= viewportWidth
        if (style.position === 'fixed' && offCanvas) continue

        const direct = dom.directText(el)
        const idx = probes.length
        el.setAttribute(idxAttr, String(idx))

        probes.push({
          idx,
          selector: label(el),
          text: directSnippet(direct),
          rect: flat(rect),
          fontSize: parseFloat(style.fontSize) || 0,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          hasDirectText: direct !== '',
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
    { clickTargetSelector: CLICK_TARGET_SELECTOR, minTouchTarget: MIN_TOUCH_TARGET, idxAttr: PROBE_IDX_ATTR },
  )
}

/**
 * Resolves the full-subtree text fallback for probes that had no direct text
 * of their own, but only for the given (already-flagged) probes — a targeted
 * re-query by the `data-e2e-probe-idx` snapshot() tagged them with, not
 * another walk of the whole document.
 */
async function resolveFallbackText(page: Page, probes: ElementProbe[]): Promise<void> {
  const need = probes.filter((p) => p.text === '')
  if (need.length === 0) return
  const found = await page.evaluate(
    ({ idxs, idxAttr }) => {
      const out: [number, string][] = []
      for (const idx of idxs) {
        const el = document.querySelector(`[${idxAttr}="${idx}"]`)
        if (!el) continue
        const raw = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
        out.push([idx, raw.length > 60 ? `${raw.slice(0, 59)}…` : raw])
      }
      return out
    },
    { idxs: need.map((p) => p.idx), idxAttr: PROBE_IDX_ATTR },
  )
  const byIdx = new Map(found)
  for (const p of need) {
    const fallback = byIdx.get(p.idx)
    if (fallback) p.text = fallback
  }
}

/** The three checks, addressable by name so a spec can narrow the auto-guard. */
export type ViewportCheck = 'overflow' | 'readability' | 'touch-targets'

const ALL_CHECKS: ViewportCheck[] = ['overflow', 'readability', 'touch-targets']

/** Runs the requested checks against one already-taken snapshot, resolving
 *  fallback text once for whatever ends up flagged across all of them. */
async function assertChecks(page: Page, snap: Snapshot, checks: ViewportCheck[], label: string): Promise<void> {
  const where = label ? ` [${label}]` : ''

  const overflowFlags = checks.includes('overflow')
    ? snap.probes
        .map((p) => ({ p, kind: overflowKind(p, snap.viewportWidth) }))
        .filter((x): x is { p: ElementProbe; kind: OverflowKind } => x.kind !== null)
    : []
  const readabilityFlags = checks.includes('readability')
    ? snap.probes.filter((p) => textTooSmall(p) || textNotRendered(p))
    : []
  const touchFlags = checks.includes('touch-targets') ? snap.probes.filter((p) => touchTargetTooSmall(p)) : []

  await resolveFallbackText(page, [...overflowFlags.map((f) => f.p), ...readabilityFlags, ...touchFlags])

  if (checks.includes('overflow')) {
    expect(
      snap.documentScrollWidth,
      `the document scrolls horizontally${where}: scrollWidth ${snap.documentScrollWidth} > viewport width ${snap.viewportWidth}`,
    ).toBeLessThanOrEqual(snap.viewportWidth + TOLERANCE)
    const lines = overflowFlags.map(({ p, kind }) => overflowMessage(p, kind, snap.viewportWidth))
    expect(lines, violationBlock(`horizontal overflow at ${snap.viewportWidth}px${where}`, lines)).toEqual([])
  }

  if (checks.includes('readability')) {
    const lines = readabilityFlags.map((p) => readabilityMessage(p))
    expect(lines, violationBlock(`unreadable text${where}`, lines)).toEqual([])
  }

  if (checks.includes('touch-targets')) {
    const lines = touchFlags.map((p) => touchTargetMessage(p))
    expect(lines, violationBlock(`touch targets below ${MIN_TOUCH_TARGET}px${where}`, lines)).toEqual([])
  }
}

/** §5.1 — no horizontal document scroll, and nothing sticking past an edge. */
export async function expectNoHorizontalOverflow(page: Page, label = ''): Promise<void> {
  await assertChecks(page, await snapshot(page), ['overflow'], label)
}

/** §5.2 — every visible text run is at least 12px and actually rendered. */
export async function expectReadableText(page: Page, label = ''): Promise<void> {
  await assertChecks(page, await snapshot(page), ['readability'], label)
}

/** §5.3 — mobile only: every interactive element is at least 44×44px. */
export async function expectTouchTargets(page: Page, label = ''): Promise<void> {
  await assertChecks(page, await snapshot(page), ['touch-targets'], label)
}

/**
 * Runs every check that applies to the current project, against a single DOM
 * snapshot — not one snapshot per check. Specs call this after opening an
 * intermediate state (menu, dialog, expanded tile); the final state of each
 * test is checked automatically by the fixture in ../fixtures.ts.
 */
export async function expectViewportHealthy(
  page: Page,
  opts: { isMobile?: boolean; label?: string; checks?: ViewportCheck[] } = {},
): Promise<void> {
  const requested = opts.checks ?? ALL_CHECKS
  // Touch targets are a phone concern only: a mouse hits a 20px link fine.
  const checks = opts.isMobile ? requested : requested.filter((c) => c !== 'touch-targets')
  await assertChecks(page, await snapshot(page), checks, opts.label ?? '')
}
