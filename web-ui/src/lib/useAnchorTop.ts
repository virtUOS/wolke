import { useLayoutEffect, type RefObject } from 'react'

/**
 * Publish an element's top edge as a CSS custom property on `:root`, so a
 * `position: fixed` decoration can be anchored to a piece of *content* it has
 * no relationship to in the tree.
 *
 * Used by the greeting for the launcher watermark (issue #195): the mark's top
 * aligns with the greeting's, and has to follow it when the layout above or
 * below the greeting changes — the announcement banner mounting or unmounting
 * is the case the design calls out.
 *
 * Two deliberate choices:
 *
 *  - **Document coordinates**, not viewport ones: `rect.top + scrollY`. The
 *    consumer is a fixed layer, so a viewport-relative measurement would have
 *    to be re-taken on every scroll frame and would drag the mark up the screen
 *    with the list. In document coordinates the two agree at scroll-top — the
 *    state the composition is designed in — and the mark then stays put while
 *    the list scrolls, which is what the design asks for.
 *  - **A ResizeObserver on `document.body` as well as on the element itself.**
 *    The element's own size changing is the smaller half of the problem;
 *    anything mounting or unmounting around it moves it without resizing it,
 *    and body's height is what that reliably changes. There is no
 *    position-observer primitive on the platform, and a MutationObserver over
 *    the subtree would fire on every unrelated re-render.
 *
 * Writes only when the value actually changes, so an observer callback can
 * never feed itself.
 */
export function useAnchorTop(ref: RefObject<HTMLElement | null>, property: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    let last: string | null = null

    const publish = () => {
      const next = `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`
      if (next === last) return
      last = next
      root.style.setProperty(property, next)
    }
    publish()

    window.addEventListener('resize', publish)
    // jsdom has had ResizeObserver since 21, but a test environment without it
    // should degrade to the mount measurement rather than throw.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    observer?.observe(el)
    observer?.observe(document.body)

    return () => {
      window.removeEventListener('resize', publish)
      observer?.disconnect()
      // A view without a greeting (the admin surface) must not inherit the
      // launcher's anchor.
      root.style.removeProperty(property)
    }
  }, [ref, property])
}
