// Installs the visibility/direct-text primitives that helpers/viewport.ts and
// helpers/a11y.ts both need, once per page, so neither file hand-rolls its own
// copy of the same `checkVisibility` call and child-text-node walk.
//
// Playwright's `page.evaluate` serializes only the function passed to it — it
// cannot call back into other functions from this module. Installing the
// shared logic as a real global via `addInitScript` is what makes it callable
// from either file's own `page.evaluate` body.

import type { Page } from '@playwright/test'

declare global {
  interface Window {
    __e2eDomWalk?: {
      /** Same visibility definition everywhere: rendered, not zero-opacity, not `visibility: hidden`. */
      isVisible(el: Element): boolean
      /** Trimmed text held directly in `el`'s own text nodes (not its descendants'). */
      directText(el: Element): string
    }
  }
}

/** Registers `window.__e2eDomWalk` before the app loads. Call once per test page. */
export async function installDomWalkHelpers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__e2eDomWalk = {
      isVisible(el: Element): boolean {
        return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
      },
      directText(el: Element): string {
        let out = ''
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? ''
        }
        return out.trim()
      },
    }
  })
}
