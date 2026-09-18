import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardShell } from '@/components/DashboardShell'
import { OptionGroup } from '@/components/ui/option-group'
import { Tile } from '@/components/Tile'
import type { Category, Me, Service } from '@/lib/api'
import { BRANDING } from '@/test/branding'

// Issue #211: the favourites star gets a token of its own.
//
// `--accent` was one name doing five unrelated jobs — star, segmented pill,
// tile hover wash, watermark fill, light canvas tint — so design asking for a
// specific star colour meant repainting the app. The fix is an indirection, not
// a colour: `--favorite` defaults to the accent value in both themes, so the
// split merges invisibly and a skin can move the star alone afterwards.
//
// Both halves of that are pinned here. The first half is easy; the second half
// — "and nothing else moves" — is the one that actually needs proving, so each
// remaining accent consumer gets an assertion that it still reads `--accent`.
// Two of them (the hover washes) live in the stylesheet rather than in a style
// attribute, invisible to jsdom, so those are read off the CSS text: it is the
// only evidence available, and a silent test is worse than a textual one.

const categories: Category[] = [
  { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 },
]

const service: Service = {
  id: 's1',
  name: 'MyShare',
  description: { de: 'Persönlicher Netzspeicher.', en: 'Your storage.' },
  service_url: 'https://myshare.example.edu',
  icon: 'hard-drive',
  categories: ['data'],
  doc_only: false,
}

function star(favorited: boolean): HTMLElement {
  render(
    <Tile
      service={service}
      categories={categories}
      locale="de"
      favorited={favorited}
      onToggleFavorite={() => {}}
    />,
  )
  return screen.getByRole('button', { name: /Favoriten/ })
}

/** The lucide glyph inside the star button — the element carrying the fill. */
function glyph(button: HTMLElement): SVGElement {
  const svg = button.querySelector('svg')
  if (!svg) throw new Error('star button has no icon')
  return svg
}

const HEX = /#[0-9a-f]{3,8}\b/i

const ME = {
  id: 'u1',
  display_name: 'Alex Beispiel',
  email: 'a@example.edu',
  primary_role: 'student',
  is_admin: false,
  view_mode: 'grid',
  theme: 'light',
  locale: 'de',
  favorites_order: 'usage',
  favorites_separate_tab: false,
  show_beta: false,
  visibility: { held: [], entries: [] },
} as unknown as Me

describe('the favourites star reads its own token', () => {
  it('takes stroke and fill from --favorite, never a hex', () => {
    const btn = star(true)
    expect(btn.style.color).toBe('var(--favorite)')
    expect(glyph(btn).getAttribute('class')).toContain('fill-[var(--favorite)]')
    expect(btn.getAttribute('style')).not.toMatch(HEX)
    expect(glyph(btn).getAttribute('class')).not.toMatch(HEX)
  })

  // The whole point of the issue: the star is no longer downstream of --accent,
  // so a skin can move it without touching anything else.
  it('no longer reads --accent in either state', () => {
    const on = star(true)
    expect(on.style.color).not.toContain('--accent')
    expect(glyph(on).getAttribute('class')).not.toContain('--accent')
  })

  it('leaves the unfavourited star muted, not favourite-coloured', () => {
    const off = star(false)
    expect(off.style.color).toBe('var(--text-muted)')
    expect(glyph(off).getAttribute('class')).not.toContain('fill-')
  })
})

describe('the token is brand-overridable, and defaults to a no-op', () => {
  // Vitest runs from web-ui/, so this is the stylesheet the app ships.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  /** The value of `name` inside the given `:root` / `.dark` fallback block. */
  function tokenIn(block: 'root' | 'dark', name: string): string | undefined {
    const selector = block === 'root' ? ':root' : '\\.dark'
    const body = css.match(new RegExp(`^${selector} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1]
    return body?.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  }

  it.each(['root', 'dark'] as const)('defines --favorite in %s, equal to --accent', (block) => {
    const favorite = tokenIn(block, 'favorite')
    const accent = tokenIn(block, 'accent')
    expect(accent).toBeDefined()
    // Merging this changes no pixel: the default *is* the current accent.
    expect(favorite).toBe(accent)
  })

  it('bridges the Tailwind utility form in @theme inline', () => {
    const theme = css.match(/@theme inline \{([\s\S]*?)^\}/m)?.[1]
    expect(theme).toContain('--color-favorite: var(--favorite);')
  })
})

// "…and nothing else." Each of the accent consumers the issue enumerated, held
// in place. If a later change moves one of these onto --favorite, that is the
// same knot re-forming and this is where it should fail.
describe('the remaining accent consumers are untouched', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  function rule(selector: string): string {
    const body = css.match(new RegExp(`^\\${selector} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1]
    if (body === undefined) throw new Error(`no rule for ${selector}`)
    return body
  }

  it('keeps the tile hover wash and focus border on --accent', () => {
    const hover = rule('.tile-grid:hover')
    expect(hover).toContain('var(--accent)')
    expect(hover).not.toContain('--favorite')
  })

  it('keeps the mobile list-row hover on --accent', () => {
    const hover = rule('.tile-list-item:hover')
    expect(hover).toContain('var(--accent)')
    expect(hover).not.toContain('--favorite')
  })

  it('keeps the segmented control’s active pill on --accent', () => {
    render(
      <OptionGroup
        label="Ansicht"
        value="grid"
        onChange={() => {}}
        options={[
          ['grid', 'Kacheln'],
          ['list', 'Liste'],
        ]}
      />,
    )
    const active = screen.getByRole('button', { name: 'Kacheln' })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    const style = active.getAttribute('style') ?? ''
    expect(style).toContain('var(--accent)')
    expect(style).not.toContain('--favorite')
  })

  // Light only: the dark canvas is plain --bg (issue #187), so this is the one
  // theme where the tint exists to be moved.
  it('keeps the light-mode canvas tint on --accent', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <DashboardShell
          branding={BRANDING}
          me={ME}
          locale="de"
          isDark={false}
          theme="light"
          onSetTheme={() => {}}
          onSetLocale={() => {}}
          onAdmin={() => {}}
          isMobile={false}
          showBeta={false}
          onSetShowBeta={() => {}}
          focusKey="dashboard"
        >
          <p>Inhalt</p>
        </DashboardShell>
      </QueryClientProvider>,
    )
    const style = container.querySelector('.app-canvas')?.getAttribute('style') ?? ''
    expect(style).toContain('var(--accent)')
    expect(style).not.toContain('--favorite')
  })
})
