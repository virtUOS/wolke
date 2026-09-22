import type { CSSProperties } from 'react'

// The decorative institution mark in the launcher background (issue #174).
//
// Issue #195 (design board turn 9) replaces the desktop geometry of #174/#181/
// #187 and the whole #193 exploration: the mark is anchored to the *content
// column* horizontally and to the *greeting* vertically, and the layer it sits
// in dissolves into the right gutter through a horizontal gradient mask rather
// than being cropped by an edge. See docs/specs/watermark-column-fade.md.
//
// Why a fade and not a crop: on a wide screen the part of the mark that reaches
// past the column would otherwise float alone in empty canvas (#181's finding)
// — and the frozen `clip-path` #193 tried instead read as a truncated image,
// because a hard edge on a recognisable shape always does. A gradient has no
// edge to notice, and it makes the rule width-independent: nothing about it
// changes between 1280 and 3440. What does change with width is how much of the
// fade fits — it fills the gutter there is, and below the column width there is
// none and the mark bleeds off the edge (issue #199, and the spec's "How far
// the fade gets").
//
// Rendered as a CSS-masked, token-filled box rather than an <img>: an external
// SVG in an <img> cannot take the CSS color, so the tint would not re-skin with
// the theme — which matters more since #212, where the fill became --text and
// therefore flips between the themes rather than being one colour in both.
//
// The mask URL is *configuration* (branding.watermark) — no institution
// mark is shipped in this repo (CLAUDE.md golden rule 8), and no
// value means no element at all, which is also what keeps a failed mask from
// ever painting an unmasked rectangle (see the offline note below).

/**
 * What we ship, per theme.
 *
 * Both values are **luminance parity** with what #195 shipped: issue #212 moved
 * the fill from --accent to --text (a neutral mark that does not follow the
 * highlight colour when a deployer re-skins it), and the opacities were re-set
 * so that the swap changed the mark's hue and nothing about its weight.
 *
 * Measured on the canvas each theme actually paints — light is --bg warmed with
 * 5% of the accent (DashboardShell), not #FFFFFF:
 *
 *   light  canvas (254.35,252.25,248.30)  accent @0.15 → lum 0.91407  (#195)
 *                                         text   @0.032 → lum 0.91407  (shipped)
 *   dark   canvas (22,22,24)              accent @0.07 → lum 0.01669  (#195)
 *                                         text   @0.057 → lum 0.01669  (shipped)
 *
 * Parity is on **luminance**, not on the largest per-channel delta that #187
 * and #195 reasoned with. That metric was sound while every candidate fill was
 * the same pale yellow, and stops being sound the moment the fill's own
 * luminance moves: --accent (#f2c879) is pale and sits close to the light
 * canvas in luminance while moving the blue channel a lot, whereas --text is
 * near-black there and moves luminance hard. Matching channels instead would
 * have put light at 0.087 — about 2.7x today's weight, and below AA where the
 * phone's transparent list rows let the mark show under their muted subtitle.
 *
 * Note the split **inverted** in #212: light is now the lower value. With the
 * pale accent, light needed more than dark (0.15 vs 0.07) because the fill sat
 * close to the near-white canvas; --text is the largest luminance excursion the
 * palette allows there, so it needs less, while dark's very low canvas
 * luminance compresses what the same opacity buys. Light is separately capped
 * near 0.0705 by that AA check.
 *
 * Keeping the split is the point — a single flat value is what #195 disproved.
 * See docs/specs/watermark-column-fade.md §3 and §6.
 */
export const WATERMARK_OPACITY = { light: 0.032, dark: 0.057 } as const

/**
 * The column width, published once by this component and read by everything
 * that has to agree with it (the gutter gradient and the mark's own width and
 * offset). The handoff quotes pixels for a 960px column; ours is 1180
 * (SHELL_MAX_WIDTH), so the ratios carry and the pixels do not — and a pixel
 * restated in CSS is a pixel that will disagree with the column the day it
 * changes.
 */
export const WATERMARK_COLUMN_VAR = '--launcher-max-width'

/** The vertical anchor: the greeting's own measured document offset, published
 *  by Greeting (useAnchorTop) and consumed here. */
export const WATERMARK_ANCHOR_VAR = '--greeting-top'

/**
 * First-paint fallback for the anchor, in px: the measured greeting top of a
 * desktop launcher (sticky app bar + <main>'s 28px top padding = 89px at every
 * desktop width). It is a fallback, not the implementation — the real value is
 * measured and follows the greeting — and because useAnchorTop publishes in a
 * layout effect, a launcher never actually paints with it.
 *
 * Not the handoff's 112/62 pair: those assume the announcement banner sits
 * ABOVE the greeting. In our launcher it sits below it (Dashboard.tsx), so the
 * greeting's own top does not move when a banner appears — see the PR for what
 * that means for the measurement.
 */
export const WATERMARK_FALLBACK_TOP = 89

/**
 * The geometry rule (issue #195), as ratios of the column width C:
 *
 *  - width  = 0.65 × C           → 767px at C = 1180
 *  - height = width × 47/35      → ≈1030px (from aspect-ratio, not set)
 *  - right  = −0.247 × C         → −291px, i.e. 38% of the mark's OWN width
 *                                  past the column's right edge
 *  - the layer fades to transparent over the 360px right of the column
 *
 * The mark may run off the bottom of the viewport (it does at 720p); its top
 * must never be cropped, which is what anchoring to the greeting guarantees.
 *
 * The phone geometry is #181's, unchanged and deliberately out of #195's scope:
 * a bottom-anchored box at 0.86× the viewport height, pushed 22% of its height
 * off the bottom and 36% of its width off the right, so it starts under the tab
 * row and sits behind the transparent list rows.
 */
export const WATERMARK_GEOMETRY = {
  desktop: { widthRatio: 0.65, rightRatio: -0.247, gutterFade: 360 },
  mobile: { height: '86vh', overhang: 'translate(36%, 22%)' },
} as const

/**
 * The column as it is actually RENDERED, which is not the same thing as the
 * variable: `--launcher-max-width` is a *cap*, and below it the shell's column
 * is the viewport (issue #199). The layer is the viewport, so `100%` here is
 * the viewport width and `min()` picks whichever of the two is in force.
 */
const RENDERED_COLUMN = `min(100%, var(${WATERMARK_COLUMN_VAR}))`

/** The rendered column's right edge, which is what the mark hangs off and what
 *  the fade starts at. */
const COLUMN_RIGHT = `calc(50% + ${RENDERED_COLUMN} / 2)`

/**
 * Opaque across the column, linear to transparent over the gutter to its right.
 * The left side fades in symmetrically for free; nothing of the mark reaches
 * there, so it costs nothing and keeps the gradient readable.
 *
 * The end of the fade is clamped to the layer's own right edge (issue #199).
 * Without that clamp the gradient needs `column + 360px` of half-viewport to
 * finish, i.e. about 1900px of screen — below which it ran off the side of the
 * display still opaque, and the mark was cut by the *viewport* instead of
 * dissolving. That is precisely the hard edge this rule exists to remove, so
 * the fade fills whatever gutter there is, up to the full 360px.
 */
const GUTTER_MASK =
  `linear-gradient(to right,` +
  ` transparent 0,` +
  ` #000 calc(50% - ${RENDERED_COLUMN} / 2),` +
  ` #000 ${COLUMN_RIGHT},` +
  ` transparent min(100%, calc(${COLUMN_RIGHT} + ${WATERMARK_GEOMETRY.desktop.gutterFade}px)))`

interface WatermarkProps {
  /** `branding.watermark` — a mounted asset path, or '' to render nothing.
   *
   *  Optional, and defaulted, because the value crosses a version boundary:
   *  /api/branding is public with max-age=300, so for five minutes after a
   *  deploy a client can hold the *pre-deploy* payload — which has no
   *  `watermark` key — together with the new bundle. Nothing above the shell
   *  catches a render throw, so an undefined here would be a blank page rather
   *  than a missing decoration (the stale-shell incident, #156/#158).
   *  NotificationBell defaults its own branding field for the same reason. */
  src?: string
  /** The effective dark-mode state, which picks the opacity (see above). */
  isDark?: boolean
  /** The phone layout (the shell's `isMobile`, the same 768px switch that
   *  turns the grid into the list): picks the mobile geometry. */
  isMobile?: boolean
  /** The centred content column's max width (DashboardShell's
   *  SHELL_MAX_WIDTH), which is what the mark is anchored to. */
  columnWidth?: number
}

export function Watermark({ src = '', isDark = false, isMobile = false, columnWidth = 1180 }: WatermarkProps) {
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

  const layer: CSSProperties = {
    position: 'fixed',
    inset: 0,
    // Behind everything. .app-canvas isolates, so -1 lands above the canvas's
    // own background but below all of its content — no z-index bookkeeping on
    // the app bar, the tab row, the widget or any portalled dialog.
    zIndex: -1,
    pointerEvents: 'none',
    // Published here, consumed by the gradient below and by the mark.
    [WATERMARK_COLUMN_VAR]: `${columnWidth}px`,
    // No gutter on a phone: there the column *is* the viewport, so a gradient
    // keyed to the column edge would fade the mark out over its own anchor.
    ...(isMobile
      ? {}
      : { WebkitMaskImage: GUTTER_MASK, maskImage: GUTTER_MASK }),
  } as CSSProperties

  // The column the mark is composed against: the same centred, max-width box
  // that <main> and the footer use. Anchoring to it rather than to the viewport
  // is #181's decision, kept: a mark welded to the viewport's edge agrees with
  // the cards only while the column fills the screen, and at 3440px it floats
  // alone in the empty canvas hundreds of pixels away from them.
  const column: CSSProperties = {
    position: 'relative',
    height: '100%',
    maxWidth: `var(${WATERMARK_COLUMN_VAR})`,
    margin: '0 auto',
  }

  const geometry: CSSProperties = isMobile
    ? {
        // #181, unchanged: 86% of the viewport height, pushed 22% of its height
        // off the bottom and 36% of its width off the right. The top therefore
        // sits at about a third of the screen height — under the tab row, over
        // the transparent list rows, as on the mobile reference.
        right: 0,
        bottom: 0,
        height: WATERMARK_GEOMETRY.mobile.height,
        transform: WATERMARK_GEOMETRY.mobile.overhang,
      }
    : {
        width: `calc(var(${WATERMARK_COLUMN_VAR}) * ${WATERMARK_GEOMETRY.desktop.widthRatio})`,
        right: `calc(var(${WATERMARK_COLUMN_VAR}) * ${WATERMARK_GEOMETRY.desktop.rightRatio})`,
        // Anchored to the greeting, measured (Greeting publishes it). The
        // fallback is for first paint on a surface that has no greeting; it is
        // never what a launcher renders with.
        top: `var(${WATERMARK_ANCHOR_VAR}, ${WATERMARK_FALLBACK_TOP}px)`,
      }

  const style: CSSProperties = {
    position: 'absolute',
    ...geometry,
    // The box is the mark's own portrait ratio; the mask is fitted inside it
    // (contain), so a deployment's mark of a different ratio is letterboxed
    // rather than stretched.
    aspectRatio: '35 / 47',
    pointerEvents: 'none',
    opacity: isDark ? WATERMARK_OPACITY.dark : WATERMARK_OPACITY.light,
    backgroundColor: 'var(--text)',
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  }

  return (
    <div className="app-watermark-layer" aria-hidden="true" style={layer}>
      <div className="app-watermark-column" style={column}>
        <div className="app-watermark" aria-hidden="true" style={style} />
      </div>
    </div>
  )
}
