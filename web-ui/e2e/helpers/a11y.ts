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

/** All text a sighted user can actually read at this viewport, as one normalized string. */
async function visibleTextCorpus(page: Page): Promise<string> {
  const parts = await page.evaluate(() => {
    const collected: string[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.classList.contains('sr-only')) continue
      if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      let direct = ''
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) direct += node.nodeValue ?? ''
      }
      if (direct.trim()) collected.push(direct.trim())
    }
    return collected
  })
  return parts.join(' ').replace(/\s+/g, ' ')
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
  const [announced, corpus] = await Promise.all([announcedText(page), visibleTextCorpus(page)])
  const orphans = announced.filter((text) => !corpus.includes(text))
  const where = label ? ` [${label}]` : ''
  expect(
    orphans,
    `announced but not visible${where} (${orphans.length}):\n` + orphans.map((o) => `  • "${o}"`).join('\n'),
  ).toEqual([])
}
