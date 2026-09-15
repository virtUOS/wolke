import type { CSSProperties } from 'react'

// The decorative institution mark in the launcher background (issue #174): a
// large backdrop scaled from the viewport height, anchored to the *content
// column* (issue #181) and cropped by the canvas edges (issue #187), tinted
// with --accent at 7%. It reads as a large-format print behind the content,
// not as an ornament with a visible, arbitrary position.
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
 * What we ship, per theme: the design references' 7% in both.
 *
 * The dark value was 0.035 for a while (issue #181, picked off a ladder on the
 * real canvas). That compensation existed for one reason: the desktop cards
 * were transparent, so the mark's strokes ran straight through them and their
 * text, and at 7% a 2–3px light stroke on the dark canvas stayed legible as a
 * drawing across the card row. Issue #187 made the grid card opaque, so on a
 * desktop the mark no longer crosses any card text — the strokes show only in
 * the canvas gaps — and the value goes back to what the references specify.
 * On a phone the list rows stay transparent by design (the mobile reference
 * shows the mark crossing them); the e2e spec asserts the row text stays at
 * AA against the accent composited over the canvas at this opacity.
 *
 * Kept per theme so a future re-judgement can split them again without
 * re-plumbing; the shell passes the `isDark` it already derives for the canvas.
 */
export const WATERMARK_OPACITY = { light: 0.07, dark: 0.07 } as const

/**
 * The geometry, derived by overlaying the mark's SVG on the two design
 * references (local-archive/design_handoff_watermark/reference-v2/, options
 * 7d desktop / 7f mobile) and fitting scale and offset — not from the earlier
 * handoff's `640px` / `right: -220px; bottom: -190px`, which are the numbers
 * that produced the corner ornament this replaces.
 *
 * Measured on the desktop reference (760×520 canvas, mark fitted at 640×849,
 * F1 0.94 against the stroke pixels): the mark is 1.63× the canvas height,
 * bleeds 17% of its height off the top and 22% off the bottom, and 34% of its
 * width off the right edge; its left edge lands at 45% of the canvas width.
 * On the mobile reference (300×560 canvas, mark 361×479, F1 0.95): 0.86× the
 * canvas height, bleeding 22% of its height off the bottom and 36% of its
 * width off the right — and NOT off the top: it starts right under the tab
 * row, at a third of the height.
 *
 * Expressed as: a height in vh (so the mark scales with the canvas, never a
 * fixed pixel width), a vertical anchor, and overhangs as transform
 * percentages of the element's own box — percentage right/bottom offsets on a
 * fixed element would resolve against the viewport and drift with every
 * screen size (issue #174, decision 3). The desktop top of −28vh is the 17%
 * top overhang of a 163vh box.
 */
export const WATERMARK_GEOMETRY = {
  desktop: { height: '163vh', top: '-28vh', overhang: 'translateX(34%)' },
  mobile: { height: '86vh', overhang: 'translate(36%, 22%)' },
} as const

interface WatermarkProps {
  /** `branding.watermark` — a mounted asset path, or '' to render nothing. */
  src: string
  /** The effective dark-mode state, which picks the opacity (see above). */
  isDark?: boolean
  /** The phone layout (the shell's `isMobile`, the same 768px switch that
   *  turns the grid into the list): picks the mobile geometry. */
  isMobile?: boolean
  /** The centred content column's max width (DashboardShell's
   *  SHELL_MAX_WIDTH), which is what the mark is anchored to. */
  columnWidth?: number
}

export function Watermark({ src, isDark = false, isMobile = false, columnWidth = 1180 }: WatermarkProps) {
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

  const geometry: CSSProperties = isMobile
    ? {
        // Bottom-anchored, 86% of the viewport height, pushed 22% of its
        // height off the bottom and 36% of its width off the right. The top
        // therefore sits at about a third of the screen height — under the
        // tab row, over the transparent list rows, as on the mobile reference.
        bottom: 0,
        height: WATERMARK_GEOMETRY.mobile.height,
        transform: WATERMARK_GEOMETRY.mobile.overhang,
      }
    : {
        // 163% of the viewport height with its top 28vh above the edge: it
        // bleeds off the top and the bottom at every desktop height, and its
        // right edge sits 34% of its width past the column edge.
        top: WATERMARK_GEOMETRY.desktop.top,
        height: WATERMARK_GEOMETRY.desktop.height,
        transform: WATERMARK_GEOMETRY.desktop.overhang,
      }

  const style: CSSProperties = {
    position: 'fixed',
    // Anchored to the CONTENT COLUMN, not the viewport (issue #181, kept by
    // #187). The content the mark sits behind is a centred column of at most
    // `columnWidth`; a mark welded to the viewport's edge agrees with it only
    // while the column fills the viewport, and at 3440px it floats alone in
    // the empty canvas, hundreds of pixels from the cards. `right` is
    // therefore the gap between the viewport edge and the column's right
    // edge, (100vw − column) / 2, clamped at 0 — below ~1180px this is the
    // viewport edge, and above it the mark keeps the same relationship to the
    // cards at 1280, 1920 and 3440. `fixed` is kept: it stays put while the
    // list scrolls, and the same arithmetic is what an absolutely positioned
    // wrapper would resolve to.
    right: `max(0px, calc(50vw - ${columnWidth / 2}px))`,
    ...geometry,
    // The box is the mark's own portrait ratio; the mask is fitted inside it
    // (contain), so a deployment's mark of a different ratio is letterboxed
    // rather than stretched.
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
