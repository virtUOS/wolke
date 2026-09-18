import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Watermark,
  WATERMARK_ANCHOR_VAR,
  WATERMARK_COLUMN_VAR,
  WATERMARK_FALLBACK_TOP,
  WATERMARK_GEOMETRY,
  WATERMARK_OPACITY,
} from '@/components/Watermark'
import { DashboardShell, SHELL_MAX_WIDTH } from '@/components/DashboardShell'
import { Greeting } from '@/components/Greeting'
import type { Branding } from '@/lib/branding'
import { BRANDING } from '@/test/branding'
import type { Me } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

// Issue #174: a single decorative institution mark in the launcher background.
// Issue #195 (design board turn 9) replaces the desktop geometry: the mark is
// anchored to the *content column* and to the *greeting*, and the whole layer
// dissolves into the right gutter through a horizontal gradient mask instead of
// being cropped. See docs/specs/watermark-column-fade.md.
//
// The things these tests exist to pin down are the ones that would hurt if they
// drifted:
//
//  1. **It is configuration, not a shipped asset.** CLAUDE.md golden rule 8 —
//     no institution, logo or brand asset is hardcoded anywhere. The mask URL
//     comes from `branding.watermark`, and an empty value renders *nothing at
//     all*: not a hidden element, not an unmasked box, no element in the DOM.
//     That gate is also the defence against a deployment that mounts its own
//     branding dir without a watermark.svg — a mask-image that 404s does not
//     reliably hide its own box.
//  2. **It is decoration.** Out of the accessibility tree, out of the way of
//     the pointer, and faint enough that it can never compete with content.
//  3. **Every derived number is a ratio of one column width.** The handoff's
//     pixels assume a 960px column; ours is 1180. A pixel restated in CSS is a
//     pixel that will disagree with the column the day it changes.

const MARK = '/branding/watermark.svg'

function mark(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.app-watermark')
}

function layer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.app-watermark-layer')
}

/** The inline style as written, not as jsdom re-serialises it: the geometry is
 *  carried by `calc()` and `var()` values that jsdom's CSSOM does not model. */
function css(el: HTMLElement): string {
  return el.getAttribute('style') ?? ''
}

describe('Watermark', () => {
  it('renders nothing when branding.watermark is unset', () => {
    const { container } = render(<Watermark src="" />)
    expect(mark(container)).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a whitespace-only value', () => {
    const { container } = render(<Watermark src="   " />)
    expect(container).toBeEmptyDOMElement()
  })

  // A *stale* payload is a different shape from an empty value, and it is the
  // one that hurts. /api/branding is public with max-age=300, so for five
  // minutes after a deploy a client can hold the pre-deploy JSON — which has no
  // `watermark` key at all — alongside the new bundle. There is no error
  // boundary above the shell, so `src.trim()` on an absent field is not a
  // missing decoration, it is a blank page (the stale-shell incident, #156/
  // #158). NotificationBell defaults its own branding field for this reason;
  // this is the same defence.
  it('renders nothing when the field is absent, not merely empty', () => {
    const { container } = render(<Watermark />)
    expect(container).toBeEmptyDOMElement()
  })

  it('masks with the configured URL, not a constant', () => {
    const { container } = render(<Watermark src="/branding/custom-mark.svg" />)
    const el = mark(container)!
    expect(el).not.toBeNull()
    expect(css(el)).toContain('/branding/custom-mark.svg')
    expect(css(el)).toContain('-webkit-mask-image')
    // Nothing institution-specific may be baked into the component.
    expect(container.innerHTML).not.toMatch(/uos|osnabr/i)
  })

  it('is decorative: hidden from assistive tech and from the pointer', () => {
    const { container } = render(<Watermark src={MARK} />)
    expect(layer(container)).toHaveAttribute('aria-hidden', 'true')
    expect(css(layer(container)!)).toContain('pointer-events: none')
    const el = mark(container)!
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(css(el)).toContain('pointer-events: none')
    // No accessible content of any kind inside it.
    expect(el).toBeEmptyDOMElement()
  })

  // Issue #212: the mark is a neutral decoration, not a second place the
  // highlight colour shows up. Filling it with --text means a deployer who
  // re-skins the accent does not move the watermark with it.
  it('tints with the text token, never a hex', () => {
    const { container } = render(<Watermark src={MARK} />)
    const el = mark(container)!
    expect(el.style.backgroundColor).toBe('var(--text)')
    // The whole point of #212: it is no longer downstream of --accent.
    expect(css(el)).not.toContain('--accent')
    expect(css(el)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('sits behind content in the canvas stacking context', () => {
    const { container } = render(<Watermark src={MARK} />)
    // -1 inside .app-canvas's isolated stacking context: above the canvas's own
    // background, below every one of its descendants — no z-index bookkeeping
    // on the app bar, the tab row, the widget or any portalled dialog.
    expect(layer(container)!.style.zIndex).toBe('-1')
    // The mark itself carries none: it stacks inside the layer.
    expect(mark(container)!.style.zIndex).toBe('')
  })

  // --- Opacity ---------------------------------------------------------------
  //
  // Per theme since #195, and re-set in #212 when the fill moved from --accent
  // to --text. Both values are LUMINANCE parity with what #195 shipped, so the
  // swap changed the mark's hue and not its weight — see
  // docs/specs/watermark-column-fade.md §3. Measured on the canvas each theme
  // actually paints (light is --bg warmed with 5% accent, not #FFFFFF):
  //
  //   light  canvas (254.35,252.25,248.30)  accent@0.15 → lum 0.91407
  //                                         text  @0.032 → lum 0.91407
  //   dark   canvas (22,22,24)              accent@0.07 → lum 0.01669
  //                                         text  @0.057 → lum 0.01669
  //
  // Parity is on luminance rather than on the largest per-channel delta #195
  // and #187 used: that metric was sound while every candidate fill was the
  // same pale yellow, and stops being sound once the fill's own luminance
  // moves. Matching channels instead would have put light at 0.087 — ~2.7x
  // today's weight, and below AA on the phone (§3, "the accessibility
  // ceiling").
  describe('opacity', () => {
    it('sets dark at luminance parity with the accent value #195 shipped', () => {
      const { container } = render(<Watermark src={MARK} isDark />)
      expect(Number(mark(container)!.style.opacity)).toBe(WATERMARK_OPACITY.dark)
      expect(WATERMARK_OPACITY.dark).toBe(0.057)
      // 0.08 is the board's ceiling (issue #187, frame 7e). It was derived on
      // the dark canvas and binds there only. It no longer constrains anything
      // — parity lands well under it — but a value above it would still be a
      // decision nobody has taken, so the assertion stays.
      expect(WATERMARK_OPACITY.dark).toBeLessThanOrEqual(0.08)
    })

    it('sets light lower than dark, which is what keeps the two equally faint', () => {
      const { container } = render(<Watermark src={MARK} isDark={false} />)
      expect(Number(mark(container)!.style.opacity)).toBe(WATERMARK_OPACITY.light)
      expect(WATERMARK_OPACITY.light).toBe(0.032)
      // The relationship INVERTED in #212, and the inversion is the tell that
      // the fill changed character. With the pale accent, light needed more
      // opacity than dark (0.15 vs 0.07) because the fill sat close to the
      // near-white canvas in luminance. --text is near-black there: the
      // largest luminance excursion the palette allows, so it needs less. In
      // dark the canvas's own luminance floor compresses what the same opacity
      // buys, so dark needs more. A future edit that restores light > dark has
      // almost certainly reverted the fill.
      expect(WATERMARK_OPACITY.light).toBeLessThan(WATERMARK_OPACITY.dark)
    })

    it('stays a texture in both themes: never opaque enough to read as an object', () => {
      for (const isDark of [false, true]) {
        const { container } = render(<Watermark src={MARK} isDark={isDark} />)
        const opacity = Number(mark(container)!.style.opacity)
        expect(opacity).toBeGreaterThan(0)
        expect(opacity).toBeLessThanOrEqual(0.2)
      }
    })

    it('defaults to the light value when no theme is given', () => {
      const { container } = render(<Watermark src={MARK} />)
      expect(Number(mark(container)!.style.opacity)).toBe(WATERMARK_OPACITY.light)
    })
  })

  // --- Geometry -------------------------------------------------------------

  describe('geometry (issue #195): column-anchored, dissolving into the gutter', () => {
    it('publishes the column width once and derives everything from that one variable', () => {
      const { container } = render(<Watermark src={MARK} columnWidth={1180} />)
      // Declared on the layer…
      expect(css(layer(container)!)).toContain(`${WATERMARK_COLUMN_VAR}: 1180px`)
      // …and read by both the gutter gradient and the mark. No second 1180.
      const gradient = css(layer(container)!)
      expect(gradient).toContain(`var(${WATERMARK_COLUMN_VAR})`)
      const el = css(mark(container)!)
      expect(el).toContain(`var(${WATERMARK_COLUMN_VAR})`)
      expect(el).not.toContain('1180px')
    })

    it('takes the column width from the shell rather than restating it', () => {
      const { container } = render(<Watermark src={MARK} columnWidth={1000} />)
      expect(css(layer(container)!)).toContain(`${WATERMARK_COLUMN_VAR}: 1000px`)
    })

    it('fades the whole layer out over the 360px gutter to the right of the column', () => {
      const { container } = render(<Watermark src={MARK} />)
      const style = css(layer(container)!)
      // Opaque from the column's left edge to its right edge, then linear to
      // transparent 360px further right. Not a crop: #193 proved a hard edge
      // reads as a truncated image on a wide screen.
      for (const prop of ['mask-image', '-webkit-mask-image']) {
        expect(style).toContain(prop)
      }
      expect(style).toContain('linear-gradient(to right')
      expect(style).toContain(`calc(50% - min(100%, var(${WATERMARK_COLUMN_VAR})) / 2)`)
      expect(style).toContain(`calc(50% + min(100%, var(${WATERMARK_COLUMN_VAR})) / 2)`)
      expect(style).toContain(
        `min(100%, calc(calc(50% + min(100%, var(${WATERMARK_COLUMN_VAR})) / 2) + ${WATERMARK_GEOMETRY.desktop.gutterFade}px))`,
      )
      expect(WATERMARK_GEOMETRY.desktop.gutterFade).toBe(360)
    })

    // Issue #199. The stops above are not the cap and a constant; both halves
    // of that matter, and neither is visible in a jsdom render, so they are
    // stated here as the reason the expressions look the way they do.
    it('keys the fade to the rendered column and ends it inside the viewport', () => {
      const { container } = render(<Watermark src={MARK} columnWidth={1180} />)
      const style = css(layer(container)!)
      // 1. `--launcher-max-width` is a CAP, not the column: below it the shell's
      //    column is the viewport, and the layer IS the viewport, so `100%` is
      //    the other candidate and min() picks whichever is in force.
      expect(style).toContain(`min(100%, var(${WATERMARK_COLUMN_VAR}))`)
      // 2. The fade ends at the layer's own right edge at the latest. Without
      //    this the gradient needs `column + 360px` of half-viewport to finish
      //    — about 1900px of screen — and below that it ran off the side still
      //    opaque, so the mark was cut by the viewport instead of dissolving.
      //    Asserted at the pixel level at 1280 in the e2e suite.
      expect(style).toContain('min(100%, calc(')
      // The cap is still the one published value; nothing restates 1180.
      expect(style).toContain(`${WATERMARK_COLUMN_VAR}: 1180px`)
      expect(style.split('1180px')).toHaveLength(2)
    })

    it('is a fixed, full-viewport layer', () => {
      const { container } = render(<Watermark src={MARK} />)
      const el = layer(container)!
      expect(el.style.position).toBe('fixed')
      expect(el.style.inset).toBe('0px')
      // A fixed box contributes nothing to the document's scrollable overflow,
      // which is what lets a ~1030px mark hang off the bottom without giving
      // the user anything to scroll.
    })

    it('centres a wrapper of exactly the column width and hangs the mark off its right edge', () => {
      const { container } = render(<Watermark src={MARK} />)
      const column = container.querySelector<HTMLElement>('.app-watermark-column')!
      expect(css(column)).toContain(`max-width: var(${WATERMARK_COLUMN_VAR})`)
      expect(column.style.margin).toBe('0px auto')
      expect(column.style.position).toBe('relative')

      const el = mark(container)!
      expect(el.style.position).toBe('absolute')
      // Width = 0.65 × column (767px at 1180); right = −0.247 × column
      // (−291px), which puts 38% of the mark's own width past the column edge.
      expect(css(el)).toContain(`calc(var(${WATERMARK_COLUMN_VAR}) * ${WATERMARK_GEOMETRY.desktop.widthRatio})`)
      expect(css(el)).toContain(`calc(var(${WATERMARK_COLUMN_VAR}) * ${WATERMARK_GEOMETRY.desktop.rightRatio})`)
      expect(WATERMARK_GEOMETRY.desktop.widthRatio).toBe(0.65)
      expect(WATERMARK_GEOMETRY.desktop.rightRatio).toBe(-0.247)
      // The box is the mark's own portrait ratio; the mask is fitted inside it
      // (contain), so a deployment's mark of a different ratio is letterboxed
      // rather than stretched.
      expect(el.style.aspectRatio).toBe('35 / 47')
      // No viewport-derived height any more: the mark is sized by the column.
      expect(css(el)).not.toContain('vh')
    })

    it('anchors its top to the measured greeting, with a fallback only for first paint', () => {
      const { container } = render(<Watermark src={MARK} />)
      expect(css(mark(container)!)).toContain(
        `top: var(${WATERMARK_ANCHOR_VAR}, ${WATERMARK_FALLBACK_TOP}px)`,
      )
    })

    it('leaves the phone geometry of issue #181 exactly as it was, and drops the gutter mask there', () => {
      const { container } = render(<Watermark src={MARK} isMobile />)
      const el = mark(container)!
      expect(el.style.height).toBe(WATERMARK_GEOMETRY.mobile.height)
      expect(el.style.height).toBe('86vh')
      expect(el.style.bottom).toBe('0px')
      expect(el.style.right).toBe('0px')
      expect(el.style.top).toBe('')
      expect(el.style.width).toBe('')
      expect(el.style.transform).toBe('translate(36%, 22%)')
      // No gutter on a phone: the column *is* the viewport there, so a gradient
      // keyed to the column edge would fade the mark out over its own anchor.
      expect(css(layer(container)!)).not.toContain('linear-gradient')
    })

    it('defaults to the desktop geometry', () => {
      const { container } = render(<Watermark src={MARK} />)
      expect(css(mark(container)!)).toContain(`var(${WATERMARK_COLUMN_VAR})`)
      expect(mark(container)!.style.height).toBe('')
    })
  })
})

// --- The vertical anchor ----------------------------------------------------
//
// The greeting owns its own measurement and publishes it; the mark consumes it.
// Nothing is drilled through the shell, and nothing queries across components
// for an element it does not own.

describe('Greeting publishes its top as the watermark anchor', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(WATERMARK_ANCHOR_VAR)
  })

  it('sets the anchor custom property on mount', () => {
    render(<Greeting firstName="Tim" locale="de" isMobile={false} maintenanceCount={0} onShowMaintenance={() => {}} />)
    expect(document.documentElement.style.getPropertyValue(WATERMARK_ANCHOR_VAR)).toMatch(/^-?\d+px$/)
  })

  it('removes it again when the greeting goes away, so no stale anchor survives a view change', () => {
    const { unmount } = render(
      <Greeting firstName="Tim" locale="de" isMobile={false} maintenanceCount={0} onShowMaintenance={() => {}} />,
    )
    unmount()
    expect(document.documentElement.style.getPropertyValue(WATERMARK_ANCHOR_VAR)).toBe('')
  })
})

// --- Placement in the shell -------------------------------------------------
//
// The mark belongs to the launcher, not to the admin surface, and the shell is
// where that is decided. DashboardShell is shared by both views, so these
// assert the `watermark` prop gate the same way `search` is gated.

// The shared fixture (src/test/branding.ts) carries no mark; a mark is what
// this suite is about, so it stays an explicit override here.
const BRANDING_WITH_MARK: Branding = { ...BRANDING, watermark: MARK }

const ME = {
  id: 'u1',
  display_name: 'Alex Beispiel',
  email: 'a@example.edu',
  primary_role: 'student',
  is_admin: true,
  view_mode: 'list',
  theme: 'light',
  locale: 'de',
  favorites_order: 'usage',
  favorites_separate_tab: false,
  show_beta: false,
  visibility: { held: [], entries: [] },
} as unknown as Me

function renderShell(props: { watermark?: boolean; branding?: Branding; isDark?: boolean; isMobile?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DashboardShell
        branding={props.branding ?? BRANDING_WITH_MARK}
        me={ME}
        locale="de"
        isDark={props.isDark ?? false}
        theme="light"
        onSetTheme={() => {}}
        onSetLocale={() => {}}
        onAdmin={() => {}}
        isMobile={props.isMobile ?? false}
        showBeta={false}
        onSetShowBeta={() => {}}
        focusKey="dashboard"
        watermark={props.watermark}
      >
        <p>Inhalt</p>
      </DashboardShell>
    </QueryClientProvider>,
  )
}

describe('DashboardShell watermark placement', () => {
  it('paints the mark on the launcher shell', () => {
    const { container } = renderShell({ watermark: true })
    expect(mark(container)).not.toBeNull()
  })

  it('leaves the admin shell undecorated', () => {
    // The admin surface doesn't pass the prop, exactly as it doesn't pass
    // `search`.
    const { container } = renderShell({})
    expect(mark(container)).toBeNull()
  })

  it('contributes nothing to the accessibility tree', async () => {
    const { container, baseElement } = renderShell({ watermark: true })
    expect(mark(container)).not.toBeNull()
    // `region` is a page-level rule this isolated render can't satisfy; see
    // a11y.test.tsx for the same exclusion.
    await expectNoAxeViolations(baseElement, ['region'])
  })

  it('anchors the mark to the shell\'s own content column', () => {
    // SHELL_MAX_WIDTH is the column <main> and the footer share; the mark and
    // the gutter gradient both hang off *that* edge, so the shell passes it
    // rather than the mark carrying a second copy of the number.
    const { container } = renderShell({ watermark: true })
    expect(css(layer(container)!)).toContain(`${WATERMARK_COLUMN_VAR}: ${SHELL_MAX_WIDTH}px`)
  })

  it('threads the shell\'s theme through to the mark', () => {
    // The shell already derives isDark for the canvas; the mark takes the same
    // value rather than reading the theme a second way.
    const { container } = renderShell({ watermark: true, isDark: true })
    expect(Number(mark(container)!.style.opacity)).toBe(WATERMARK_OPACITY.dark)
  })

  it('threads the shell\'s layout through to the mark, so the phone geometry follows the same 768px switch as the tiles', () => {
    const desktop = renderShell({ watermark: true, isMobile: false })
    const phone = renderShell({ watermark: true, isMobile: true })
    expect(mark(desktop.container)!.style.height).toBe('')
    expect(mark(phone.container)!.style.height).toBe(WATERMARK_GEOMETRY.mobile.height)
  })

  it('renders nothing even on the launcher when branding has no mark', () => {
    const { container } = renderShell({ watermark: true, branding: { ...BRANDING_WITH_MARK, watermark: '' } })
    expect(mark(container)).toBeNull()
  })

  it('survives a stale branding payload that predates the watermark field', () => {
    // The shape a client five minutes either side of a deploy actually holds:
    // the key is missing, not empty. The shell must render, not throw.
    const stale: Partial<Branding> = { ...BRANDING_WITH_MARK }
    delete stale.watermark
    const { container } = renderShell({ watermark: true, branding: stale as Branding })
    expect(mark(container)).toBeNull()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})
