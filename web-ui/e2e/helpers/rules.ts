// Pure verdict logic for the viewport assertions (docs/specs/responsive-viewport-testing.md §5).
//
// The DOM walk that produces ElementProbe values runs in the browser
// (helpers/viewport.ts); the *judgement* lives here, in plain functions over
// plain data, so the rules are unit-testable without a browser and a failure
// message can be built in Node where it is readable.

/** A DOM rect, flattened to what the rules need. */
export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/** One visible element, as measured in the page. */
export interface ElementProbe {
  /** Position in this snapshot's probe list — how a violation looks up the
   *  live element again to resolve its fallback text lazily (see viewport.ts). */
  idx: number
  /** `tag#id.class` — enough to find the element again. */
  selector: string
  /** Direct text snippet (capped). Empty when the element has no text node of
   *  its own; a violation lazily resolves the full-subtree fallback then. */
  text: string
  rect: Rect
  /** Computed font-size in px. */
  fontSize: number
  scrollWidth: number
  clientWidth: number
  /** Computed `overflow-x`. */
  overflowX: string
  /** Computed `text-overflow`. */
  textOverflow: string
  /** True when a direct child text node holds non-whitespace text. */
  hasDirectText: boolean
  /** True for links/buttons/form controls — the touch-target population. */
  interactive: boolean
  /** The rect the touch target is measured against (may be a padded parent). */
  hitRect: Rect
  /** Set by `data-e2e-small-target-ok` — a reviewed, deliberate exception. */
  smallTargetOk: boolean
}

/** Subpixel rounding slack, in px. */
export const TOLERANCE = 1
/** Minimum computed font-size for text, in px (docs/03 §2: the scale floors at 0.75rem). */
export const MIN_FONT_SIZE = 12
/** Minimum touch-target edge, in px (docs/03 §4). */
export const MIN_TOUCH_TARGET = 44

/** An element whose own `overflow-x` makes it a sanctioned scroll container. */
export function isScrollContainer(overflowX: string): boolean {
  return overflowX === 'auto' || overflowX === 'scroll'
}

export type OverflowKind =
  /** The element's own box pokes past a viewport edge. */
  | 'outside-viewport'
  /** The element's content is wider than its box, with no scrolling or ellipsis. */
  | 'clipped-content'

/**
 * Why this element violates the horizontal-overflow rule, or null if it doesn't.
 *
 * Both checks apply to every element, scroll containers included: a scroll
 * container may overflow *inside* (that is its job) but its own box must still
 * fit the viewport.
 */
export function overflowKind(p: ElementProbe, viewportWidth: number, tolerance = TOLERANCE): OverflowKind | null {
  const hasArea = p.rect.width > 0 && p.rect.height > 0
  if (hasArea && (p.rect.right > viewportWidth + tolerance || p.rect.left < -tolerance)) {
    return 'outside-viewport'
  }
  const contentWider = p.scrollWidth > p.clientWidth + tolerance
  if (contentWider && !isScrollContainer(p.overflowX) && p.textOverflow !== 'ellipsis') {
    return 'clipped-content'
  }
  return null
}

/** Text rendered below the readable floor. */
export function textTooSmall(p: ElementProbe, min = MIN_FONT_SIZE): boolean {
  return p.hasDirectText && p.fontSize < min
}

/** Text collapsed to no height — present in the tree, invisible on screen. */
export function textNotRendered(p: ElementProbe): boolean {
  return p.hasDirectText && p.rect.height <= 0
}

/** An interactive element whose hit area is under the touch-target floor. */
export function touchTargetTooSmall(p: ElementProbe, min = MIN_TOUCH_TARGET): boolean {
  if (!p.interactive || p.smallTargetOk) return false
  return p.hitRect.width < min || p.hitRect.height < min
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function rect(r: Rect): string {
  return `x ${fmt(r.left)}…${fmt(r.right)} (w ${fmt(r.width)}, h ${fmt(r.height)})`
}

/** `tag#id.class "text…"` — the shared prefix of every violation line. */
export function describe(p: ElementProbe): string {
  return p.text ? `${p.selector} "${p.text}"` : p.selector
}

export function overflowMessage(p: ElementProbe, kind: OverflowKind, viewportWidth: number): string {
  if (kind === 'outside-viewport') {
    return `${describe(p)} extends past the viewport: ${rect(p.rect)} vs viewport width ${fmt(viewportWidth)}`
  }
  return (
    `${describe(p)} clips its content: scrollWidth ${fmt(p.scrollWidth)} > clientWidth ` +
    `${fmt(p.clientWidth)} with overflow-x: ${p.overflowX} and no text-overflow: ellipsis`
  )
}

export function readabilityMessage(p: ElementProbe): string {
  if (textNotRendered(p)) return `${describe(p)} renders text at zero height: ${rect(p.rect)}`
  return `${describe(p)} renders text at ${fmt(p.fontSize)}px, below the ${MIN_FONT_SIZE}px floor`
}

export function touchTargetMessage(p: ElementProbe, min = MIN_TOUCH_TARGET): string {
  return (
    `${describe(p)} has a ${fmt(p.hitRect.width)}×${fmt(p.hitRect.height)}px hit area, ` +
    `below the ${min}×${min}px floor (add data-e2e-small-target-ok only for a reviewed exception)`
  )
}

/** Renders a violation list into one indented block for the assertion message. */
export function violationBlock(title: string, lines: string[]): string {
  return [`${title} (${lines.length}):`, ...lines.map((l) => `  • ${l}`)].join('\n')
}
