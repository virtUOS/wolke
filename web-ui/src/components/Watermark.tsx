import type { CSSProperties } from 'react'

// The decorative institution mark in the launcher background (issue #174): one
// element, anchored bottom-right of the viewport and hanging about a third off
// both edges, tinted with --accent at 7%.
//
// Rendered as a CSS-masked, token-filled box rather than an <img>: an external
// SVG in an <img> cannot take the CSS color, so the tint would not re-skin with
// the theme. The mask URL is *configuration* (branding.watermark) — no
// institution mark is shipped in this repo (CLAUDE.md golden rule 8), and no
// value means no element at all, which is also what keeps a failed mask from
// ever painting an unmasked rectangle (see the offline note below).

/** The ceiling from the design handoff. Past ~0.08 the shape stops being a
 *  texture and becomes a readable object competing with the content. */
export const WATERMARK_MAX_OPACITY = 0.08

/** What we actually ship. Tuned on the real canvas, which is itself already
 *  accent-tinted (DashboardShell: 5% light / 7% dark), not on the flat mockup. */
export const WATERMARK_OPACITY = 0.07

interface WatermarkProps {
  /** `branding.watermark` — a mounted asset path, or '' to render nothing. */
  src: string
}

export function Watermark({ src }: WatermarkProps) {
  const url = src.trim()
  // The config gate, and the only defence that actually holds: a mask-image
  // that fails to load (a branding mount without the file, or an installed PWA
  // offline — /branding/ is on the service worker's navigateFallbackDenylist
  // and has no runtime cache) leaves the box *unmasked* in Chromium, which here
  // would be a 640px accent rectangle in the corner. So the element only ever
  // exists when a deployment has said it does.
  if (!url) return null

  // CSS.escape-free quoting: url("…") with the quotes doubled, so a path with a
  // parenthesis or a space can't break out of the function.
  const mask = `url("${url.replace(/["\\]/g, '\\$&')}")`

  const style: CSSProperties = {
    position: 'fixed',
    // Anchor at the corner and push out with a transform, NOT with negative
    // percentage offsets: percentage right/bottom on a fixed element resolve
    // against the *viewport*, so the framing would drift with every screen
    // height. Transform percentages resolve against the element's own box, so
    // "a third off both edges" is exactly true at 324px and at 1920px alike.
    right: 0,
    bottom: 0,
    transform: 'translate(33%, 33%)',
    width: 'min(90vw, 640px)',
    aspectRatio: '35 / 47',
    // Behind everything. .app-canvas isolates, so -1 lands above the canvas's
    // own background but below all of its content — no z-index bookkeeping on
    // the app bar, the tab row, the widget or any portalled dialog.
    zIndex: -1,
    pointerEvents: 'none',
    opacity: WATERMARK_OPACITY,
    backgroundColor: 'var(--accent)',
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  }

  return <div className="app-watermark" aria-hidden="true" style={style} />
}
