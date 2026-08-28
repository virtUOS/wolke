// Accessibility-tree assertions.
//
// Narrow on purpose: axe in e2e is a non-goal of the viewport spec (§2) — the
// component suite covers that. What belongs here is the one thing only a real
// browser at a real width can answer: what the screen reader is offered at this
// viewport, as opposed to what the eye is offered.

import { expect, type Page } from '@playwright/test'

// Roles whose text is announced *content*, as opposed to a control's accessible
// name (a link or button may legitimately be labelled differently from its
// visible text — an icon button has no visible text at all).
const CONTENT_ROLES = 'text|paragraph|heading|listitem|caption'

// An aria snapshot writes a node two different ways, and both carry content:
//   - text: 4 Dienste                     ← role, then a YAML value
//   - heading "Guten Tag, Test." [level=1] ← role, then a quoted name (+ attrs)
// A value is quoted whenever it needs to be (a colon in the text, say), so the
// quotes have to come off before comparing it with what is on the screen.
const NAMED_LINE = new RegExp(`^\\s*-\\s+(?:${CONTENT_ROLES})\\s+("(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*')`)
const KEYED_LINE = new RegExp(`^\\s*-\\s+(?:${CONTENT_ROLES}):\\s*(.*)$`)

/** A YAML block scalar header (`|`, `>-`, `|2`, …): the value is on later lines. */
const BLOCK_SCALAR = /^[|>][-+]?\d*$|^[|>]\d*[-+]?$/

/** Strips YAML quoting from a scalar, leaving the text a reader would announce. */
export function unquoteScalar(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/**
 * The announced text content of an aria snapshot, one entry per node — the pure
 * half of announcedText(), so the line grammar above can be unit-tested.
 *
 * Known gap: a block scalar's value lives on the following lines and is skipped
 * (reporting the literal "|" as announced text would be a false positive).
 */
export function announcedTextFromSnapshot(snapshot: string): string[] {
  const out: string[] = []
  for (const line of snapshot.split('\n')) {
    const named = NAMED_LINE.exec(line)
    const raw = named ? named[1] : KEYED_LINE.exec(line)?.[1]?.trim()
    if (raw === undefined || raw === '' || BLOCK_SCALAR.test(raw)) continue
    const text = unquoteScalar(raw).replace(/\s+/g, ' ').trim()
    if (text !== '') out.push(text)
  }
  return out
}

/** The announced text content of the live page, one entry per accessibility-tree node. */
export async function announcedText(page: Page): Promise<string[]> {
  return announcedTextFromSnapshot(await page.locator('body').ariaSnapshot())
}

/**
 * Two corpora from one walk: `visible` is all text a sighted user can
 * actually read at this viewport; `opacityZero` is text that is rendered
 * (present, correctly laid out, just `opacity: 0`) rather than actually
 * removed from the page — a legitimate pattern (an animation's initial
 * state, a deliberately transparent hit target), not the responsive layout
 * dropping content, so it is exempt from the orphan check rather than a
 * false positive on every such element.
 */
async function textCorpora(page: Page): Promise<{ visible: string; opacityZero: Set<string> }> {
  const result = await page.evaluate(() => {
    const dom = window.__e2eDomWalk!
    const visible: string[] = []
    const opacityZero: string[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.classList.contains('sr-only')) continue
      const direct = dom.directText(el)
      if (!direct) continue
      if (dom.isVisible(el)) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) visible.push(direct)
        continue
      }
      const laidOut = el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })
      if (laidOut && getComputedStyle(el).opacity === '0') opacityZero.push(direct)
    }
    return { visible, opacityZero }
  })
  return { visible: result.visible.join(' ').replace(/\s+/g, ' '), opacityZero: new Set(result.opacityZero) }
}

/**
 * Asserts that everything the accessibility tree announces as content is also
 * on the screen at this viewport (issue #35).
 *
 * The rule is not "hidden implies aria-hidden" — content deliberately written
 * for screen readers only is legitimate. The rule is the converse: when the
 * responsive layout *drops* information because a phone user should not have to
 * wade through it, dropping it visually while still announcing it gives the
 * screen-reader user the long version of a screen that was shortened for
 * everyone else.
 */
export async function expectNothingInvisibleAnnounced(page: Page, label = ''): Promise<void> {
  const [announced, { visible, opacityZero }] = await Promise.all([announcedText(page), textCorpora(page)])
  const orphans = announced.filter((text) => !visible.includes(text) && !opacityZero.has(text))
  const where = label ? ` [${label}]` : ''
  expect(
    orphans,
    `announced but not visible${where} (${orphans.length}):\n` + orphans.map((o) => `  • "${o}"`).join('\n'),
  ).toEqual([])
}
