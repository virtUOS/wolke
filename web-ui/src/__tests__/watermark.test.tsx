import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Watermark, WATERMARK_GEOMETRY, WATERMARK_MAX_OPACITY, WATERMARK_OPACITY } from '@/components/Watermark'
import { DashboardShell, SHELL_MAX_WIDTH } from '@/components/DashboardShell'
import type { Branding } from '@/lib/branding'
import type { Me } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

// Issue #174: a single decorative institution mark in the launcher background.
// Issue #187 rebuilt it as a full-bleed backdrop: scaled from the viewport
// height, anchored to the content column (issue #181) and cropped by the
// canvas edges, per the design references — no longer a corner ornament.
//
// The two things these tests exist to pin down are the two that would hurt if
// they drifted:
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

const MARK = '/branding/watermark.svg'

function mark(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.app-watermark')
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

  it('masks with the configured URL, not a constant', () => {
    const { container } = render(<Watermark src="/branding/custom-mark.svg" />)
    const el = mark(container)!
    expect(el).not.toBeNull()
    expect(el.style.maskImage).toContain('/branding/custom-mark.svg')
    expect(el.style.getPropertyValue('-webkit-mask-image')).toContain('/branding/custom-mark.svg')
    // Nothing institution-specific may be baked into the component.
    expect(container.innerHTML).not.toMatch(/uos|osnabr/i)
  })

  it('is decorative: hidden from assistive tech and from the pointer', () => {
    const { container } = render(<Watermark src={MARK} />)
    const el = mark(container)!
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el.style.pointerEvents).toBe('none')
    // No accessible content of any kind inside it.
    expect(el).toBeEmptyDOMElement()
  })

  it('stays at or below the 0.08 opacity ceiling in both themes', () => {
    for (const isDark of [false, true]) {
      const { container } = render(<Watermark src={MARK} isDark={isDark} />)
      const opacity = Number(mark(container)!.style.opacity)
      expect(opacity).toBeGreaterThan(0)
      expect(opacity).toBeLessThanOrEqual(WATERMARK_MAX_OPACITY)
    }
    expect(WATERMARK_MAX_OPACITY).toBeLessThanOrEqual(0.08)
    expect(WATERMARK_OPACITY.light).toBeLessThanOrEqual(WATERMARK_MAX_OPACITY)
    expect(WATERMARK_OPACITY.dark).toBeLessThanOrEqual(WATERMARK_MAX_OPACITY)
  })

  it('is 0.07 in both themes — the references\' value, no per-theme compensation (issue #187)', () => {
    // #181 pulled dark down to 0.035 because the mark's strokes ran through
    // transparent cards and competed with their text. #187 made the desktop
    // cards opaque, so the mark crosses no card text any more and the
    // compensation goes with it: both themes start from the references' 7%.
    const light = render(<Watermark src={MARK} isDark={false} />)
    const dark = render(<Watermark src={MARK} isDark />)
    expect(Number(mark(light.container)!.style.opacity)).toBe(WATERMARK_OPACITY.light)
    expect(Number(mark(dark.container)!.style.opacity)).toBe(WATERMARK_OPACITY.dark)
    expect(WATERMARK_OPACITY.light).toBe(0.07)
    expect(WATERMARK_OPACITY.dark).toBe(0.07)
  })

  it('defaults to the light value when no theme is given', () => {
    const { container } = render(<Watermark src={MARK} />)
    expect(Number(mark(container)!.style.opacity)).toBe(WATERMARK_OPACITY.light)
  })

  it('tints with the accent token, never a hex', () => {
    const { container } = render(<Watermark src={MARK} />)
    const el = mark(container)!
    expect(el.style.backgroundColor).toBe('var(--accent)')
    expect(el.getAttribute('style')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  // Issue #187 geometry, derived by overlaying the mark on the two design
  // references (local-archive/design_handoff_watermark/reference-v2/), not
  // from the old handoff's pixel values — those produced the corner ornament
  // this replaces. Measured on the desktop reference: the mark is 1.63× the
  // canvas height, bleeds 17% of its height off the top and 22% off the
  // bottom, and 34% of its width off the right edge. On the mobile reference
  // it is 0.86× the canvas height, bleeds 22% off the bottom and 36% off the
  // right, and does NOT bleed off the top — it starts under the tab row.
  describe('geometry (issue #187): a backdrop scaled from the viewport height', () => {
    it('on a desktop is 1.63× the viewport height and bleeds off the top and the bottom', () => {
      const { container } = render(<Watermark src={MARK} isMobile={false} />)
      const el = mark(container)!
      expect(el.style.position).toBe('fixed')
      expect(el.style.height).toBe(WATERMARK_GEOMETRY.desktop.height)
      expect(el.style.top).toBe(WATERMARK_GEOMETRY.desktop.top)
      expect(el.style.height).toBe('163vh')
      expect(el.style.top).toBe('-28vh')
      // No fixed pixel width any more: the box follows its height.
      expect(el.style.width).toBe('')
      expect(el.style.aspectRatio).toBe('35 / 47')
      // The right overhang is a transform on the element's own box, as in
      // #174 decision 3 — percentage offsets would resolve against the
      // viewport and drift with every screen size.
      expect(el.style.transform).toBe('translateX(34%)')
    })

    it('on a phone is 0.86× the viewport height, anchored at the bottom, bleeding off the bottom and the right only', () => {
      const { container } = render(<Watermark src={MARK} isMobile />)
      const el = mark(container)!
      expect(el.style.position).toBe('fixed')
      expect(el.style.height).toBe(WATERMARK_GEOMETRY.mobile.height)
      expect(el.style.height).toBe('86vh')
      expect(el.style.bottom).toBe('0px')
      expect(el.style.top).toBe('')
      expect(el.style.width).toBe('')
      expect(el.style.transform).toBe('translate(36%, 22%)')
    })

    it('defaults to the desktop geometry', () => {
      const { container } = render(<Watermark src={MARK} />)
      expect(mark(container)!.style.height).toBe('163vh')
    })

    // Issue #181's decision, carried over by #187: anchored to the *content
    // column*, not the viewport. The two agree only while the column fills the
    // viewport; on a wide screen a viewport-anchored mark floats alone in the
    // empty canvas, hundreds of pixels from the cards it is meant to sit behind.
    it('anchors to the right edge of the content column, falling back to the viewport edge below it', () => {
      const { container } = render(<Watermark src={MARK} columnWidth={1180} />)
      const el = mark(container)!
      // `right` is the gap between the viewport edge and the column edge —
      // (100vw − 1180px) / 2 — clamped at 0 where the column fills the
      // viewport. jsdom re-serialises the calc(), so the assertion is on its
      // parts rather than its spelling.
      expect(el.style.right).toMatch(/^max\(0px, /)
      expect(el.style.right).toContain('50vw')
      expect(el.style.right).toContain('590px')
    })

    it('takes the column width from the shell rather than restating 1180', () => {
      const { container } = render(<Watermark src={MARK} columnWidth={1000} />)
      expect(mark(container)!.style.right).toContain('500px')
    })
  })

  it('sits behind content in the canvas stacking context', () => {
    const { container } = render(<Watermark src={MARK} />)
    expect(mark(container)!.style.zIndex).toBe('-1')
  })
})

// --- Placement in the shell -------------------------------------------------
//
// The mark belongs to the launcher, not to the admin surface, and the shell is
// where that is decided. DashboardShell is shared by both views, so these
// assert the `watermark` prop gate the same way `search` is gated.


const BRANDING: Branding = {
  product_name: 'wolke',
  org_name: 'Universität Osnabrück',
  logo_light: '',
  logo_dark: '',
  favicon: '',
  watermark: MARK,
  default_locale: 'de',
  imprint_url: '',
  privacy_url: '',
  feedback_url: '',
  bot_url: '',
  help_url: '',
  news_url: '',
  assistant_widget_url: '',
  assistant_bot_id: '',
  theme: { light: {}, dark: {} },
}

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
        branding={props.branding ?? BRANDING}
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
    // SHELL_MAX_WIDTH is the column <main> and the footer share; the mark hangs
    // off *that* edge (issue #181), so the shell passes it rather than the
    // mark carrying a second copy of the number.
    const { container } = renderShell({ watermark: true })
    expect(mark(container)!.style.right).toContain(`${SHELL_MAX_WIDTH / 2}px`)
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
    expect(mark(desktop.container)!.style.height).toBe(WATERMARK_GEOMETRY.desktop.height)
    expect(mark(phone.container)!.style.height).toBe(WATERMARK_GEOMETRY.mobile.height)
  })

  it('renders nothing even on the launcher when branding has no mark', () => {
    const { container } = renderShell({ watermark: true, branding: { ...BRANDING, watermark: '' } })
    expect(mark(container)).toBeNull()
  })
})
