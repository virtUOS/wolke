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

/**
 * What we actually ship, per theme — tuned on the real canvas, which is itself
 * already accent-tinted (DashboardShell: 5% light / 7% dark), not on the flat
 * mockup the handoff was drawn against.
 *
 * The two differ because the mark is *line art*, not a solid silhouette. A
 * filled shape at 7% averages out to a wash at either theme; 2–3px strokes at
 * 7% stay legible as lines, and a light stroke on the dark canvas has far more
 * contrast headroom than the same stroke has on the light one. At a single
 * value the light theme reads as texture while the dark theme reads as a
 * drawing competing with the content — so the value is split rather than the
 * canvas tint or the tokens being touched.
 *
 * The dark value was picked off a ladder rendered on the real canvas
 * (0.07 → 0.03) rather than derived: at 0.05 and above the mark is still a
 * traceable arch crossing the card row at 1280×720, 0.04 is borderline, and
 * 0.035 is where the strokes stop resolving into a drawing while the shape is
 * still there as texture. Peak stroke contrast against the dark canvas falls
 * from 14/255 at 0.07 to 7/255 at 0.035.
 */
export const WATERMARK_OPACITY = { light: 0.07, dark: 0.035 } as const

interface WatermarkProps {
  /** `branding.watermark` — a mounted asset path, or '' to render nothing. */
  src: string
  /** The effective dark-mode state, which picks the opacity (see above). */
  isDark?: boolean
}

export function Watermark({ src, isDark = false }: WatermarkProps) {
  const url = src.trim()
  // The config gate: no configured mark, no element. A deployment that mounts
  // its own branding dir replaces the bundled set wholesale, so a watermark.svg
  // it does not provide simply 404s — and this is what keeps that from
  // depending on how a browser handles a mask it could not load.
  //
  // Measured (Chromium 151), since the reasonable worry is the opposite: a
  // failed mask renders *nothing*. The box is not left unmasked — a mask image
  // that fails to load is treated as fully transparent, which masks the element
  // out entirely. Offline the question cannot arise at all: /api/branding is
  // network-only, so the app never reaches the launcher and there is no element
  // to mask. Hence no runtime cache entry and no <img> preflight here.
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
    opacity: isDark ? WATERMARK_OPACITY.dark : WATERMARK_OPACITY.light,
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
