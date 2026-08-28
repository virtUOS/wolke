// Accessibility-tree assertions.
//
// Narrow on purpose: axe in e2e is a non-goal of the viewport spec (§2) — the
// component suite covers that. What belongs here is the one thing only a real
// browser at a real width can answer: what the screen reader is offered at this
// viewport, as opposed to what the eye is offered.

import { expect, type Page } from '@playwright/test'

/** Snapshot lines that carry announced *content* (as opposed to a control's name). */
const CONTENT_LINE = /^\s*-\s+(?:text|paragraph|heading[^:]*|listitem|caption):\s*(\S.*)$/

/** The announced text content of the page, one entry per accessibility-tree node. */
export async function announcedText(page: Page): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot()
  const out: string[] = []
  for (const line of snapshot.split('\n')) {
    const m = CONTENT_LINE.exec(line)
    if (m) out.push(m[1].replace(/\s+/g, ' ').trim())
  }
  return out
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
