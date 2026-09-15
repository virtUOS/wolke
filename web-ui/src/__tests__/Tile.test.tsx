import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockInstance } from 'vitest'
import { Tile } from '@/components/Tile'
import type { Category, Service } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const categories: Category[] = [
  { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 },
]

const service: Service = {
  id: 's1',
  name: 'MyShare',
  description: { de: 'Persönlicher Netzspeicher.', en: 'Your storage.' },
  service_url: 'https://myshare.example.edu',
  doc_url: 'https://docs.example.edu/myshare',
  icon: 'hard-drive',
  categories: ['data'],
  doc_only: false,
}

/** A launchable service without a guide: the help button has nothing to open. */
const noGuide: Service = {
  id: 's3',
  name: 'Serververwaltung',
  description: { de: 'Verwaltung der Server.', en: 'Server management.' },
  service_url: 'https://srv.example.edu',
  icon: 'server',
  categories: ['data'],
  doc_only: false,
}

const docOnly: Service = {
  id: 's2',
  name: 'WLAN an der UOS',
  description: { de: 'So verbindest du dich.', en: 'How to connect.' },
  doc_url: 'https://docs.example.edu/wifi',
  icon: 'wifi',
  categories: ['data'],
  doc_only: true,
}

describe('Tile', () => {
  it('tile is a launch link opening the service in a new tab', () => {
    render(<Tile service={service} categories={categories} locale="de" />)
    const link = screen.getByRole('link', { name: /MyShare/ })
    expect(link).toHaveAttribute('href', 'https://myshare.example.edu')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('description is always visible', () => {
    render(<Tile service={service} categories={categories} locale="de" />)
    expect(screen.getByText('Persönlicher Netzspeicher.')).toBeInTheDocument()
  })

  // Issue #177: "this entry links to a help page rather than an app" is a
  // property of the link, not a status the user is meant to act on, so it no
  // longer sits in the badge slot beside Beta and Wartung. `doc_only` itself
  // stays — it is what suppresses the redundant secondary guide button (#185).
  it.each(['grid', 'list'] as const)('a doc-only entry (%s) launches its documentation with no status badge', (layout) => {
    render(<Tile service={docOnly} categories={categories} locale="de" layout={layout} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://docs.example.edu/wifi')
    expect(screen.queryByText('Dokumentation')).not.toBeInTheDocument()
    expect(screen.queryByText('Doku')).not.toBeInTheDocument()
  })

  it.each(['grid', 'list'] as const)('a doc-only entry (%s) still carries the tag badge it has', (layout) => {
    render(<Tile service={{ ...docOnly, tag: 'beta' }} categories={categories} locale="de" layout={layout} />)
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Dokumentation')).not.toBeInTheDocument()

    cleanup()
    render(<Tile service={{ ...docOnly, tag: 'wartung' }} categories={categories} locale="de" layout={layout} />)
    expect(screen.getByText('Wartung')).toBeInTheDocument()
    expect(screen.queryByText('Dokumentation')).not.toBeInTheDocument()
  })

  // The visible badge goes; the accessible name keeps the distinction, in the
  // same family as the new-tab warning already folded into that string.
  it('keeps the documentation cue in the doc-only tile’s accessible name', () => {
    render(<Tile service={docOnly} categories={categories} locale="de" />)
    expect(
      screen.getByRole('link', { name: 'WLAN an der UOS – Dokumentation öffnen (öffnet in neuem Tab)' }),
    ).toBeInTheDocument()
  })

  it('shows the favorite star only when a handler is provided, with aria-pressed', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const { rerender } = render(<Tile service={service} categories={categories} locale="de" />)
    expect(screen.queryByRole('button', { name: /Favoriten/ })).not.toBeInTheDocument()

    rerender(<Tile service={service} categories={categories} locale="de" favorited={false} onToggleFavorite={onToggle} />)
    const star = screen.getByRole('button', { name: /zu Favoriten hinzufügen/ })
    expect(star).toHaveAttribute('aria-pressed', 'false')
    await user.click(star)
    expect(onToggle).toHaveBeenCalledWith(service)
  })

  it('fires onLaunch with plainClick=true on an ordinary left click', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn()
    render(<Tile service={service} categories={categories} locale="de" onLaunch={onLaunch} />)
    await user.click(screen.getByRole('link', { name: /MyShare/ }))
    expect(onLaunch).toHaveBeenCalledWith(service, undefined, true)
  })

  // Issue #27: a deliberate new-tab gesture (Ctrl/Cmd/Shift-click) must still
  // fire the launch (click tracking is unconditional) but flag plainClick as
  // false, so Dashboard knows not to clear the search behind it.
  it.each([
    ['ctrlKey', '{Control>}', '{/Control}'],
    ['metaKey', '{Meta>}', '{/Meta}'],
    ['shiftKey', '{Shift>}', '{/Shift}'],
  ])('fires onLaunch with plainClick=false on a %s-click', async (_name, down, up) => {
    const user = userEvent.setup()
    const onLaunch = vi.fn()
    render(<Tile service={service} categories={categories} locale="de" onLaunch={onLaunch} />)
    await user.keyboard(down)
    await user.click(screen.getByRole('link', { name: /MyShare/ }))
    await user.keyboard(up)
    expect(onLaunch).toHaveBeenCalledWith(service, undefined, false)
  })

  // Issue #185: the footer "Doku" chip became an icon-only help button in the
  // action cluster beside the star, in both layouts. It is a real <button>
  // that opens the guide in a new tab; the tile's own link is a sibling
  // underneath it, so activating help must never launch the service.
  describe('the guide (help) button', () => {
    const GUIDE_NAME_DE = 'Anleitung öffnen (öffnet in neuem Tab)'
    const GUIDE_NAME_EN = 'Open guide (opens in new tab)'
    let open: MockInstance

    beforeEach(() => {
      // jsdom has no window.open; the button must call it with the guide URL.
      open = vi.spyOn(window, 'open').mockImplementation(() => null)
    })
    afterEach(() => {
      open.mockRestore()
    })

    it.each(['grid', 'list'] as const)('renders (%s) only for a service with a guide that is not doc-only', (layout) => {
      render(<Tile service={service} categories={categories} locale="de" layout={layout} onToggleFavorite={() => {}} />)
      const help = screen.getByRole('button', { name: GUIDE_NAME_DE })
      expect(help.tagName).toBe('BUTTON')
      expect(help).toHaveAttribute('title', 'Anleitung')
      // The visible copy is "Anleitung" everywhere; "Doku" is gone for good.
      expect(screen.queryByText(/Doku/)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Doku/)).not.toBeInTheDocument()
      // Still exactly one link — the launch overlay. The guide is no longer an <a>.
      expect(screen.getAllByRole('link')).toHaveLength(1)

      cleanup()
      render(<Tile service={noGuide} categories={categories} locale="de" layout={layout} onToggleFavorite={() => {}} />)
      expect(screen.queryByRole('button', { name: GUIDE_NAME_DE })).not.toBeInTheDocument()

      cleanup()
      // Settled decision 1: a doc-only entry's own link already opens the
      // documentation, so no second control to the same URL.
      render(<Tile service={docOnly} categories={categories} locale="de" layout={layout} onToggleFavorite={() => {}} />)
      expect(screen.queryByRole('button', { name: GUIDE_NAME_DE })).not.toBeInTheDocument()
    })

    it.each(['grid', 'list'] as const)('carries the English name and tooltip (%s)', (layout) => {
      render(<Tile service={service} categories={categories} locale="en" layout={layout} />)
      expect(screen.getByRole('button', { name: GUIDE_NAME_EN })).toHaveAttribute('title', 'Guide')
    })

    it.each(['grid', 'list'] as const)('opens the guide in a new tab without launching the tile (%s)', async (layout) => {
      const user = userEvent.setup()
      const onLaunch = vi.fn()
      render(<Tile service={service} categories={categories} locale="de" layout={layout} onLaunch={onLaunch} />)
      await user.click(screen.getByRole('button', { name: GUIDE_NAME_DE }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledWith('https://docs.example.edu/myshare', '_blank', 'noopener,noreferrer')
      // Settled decision 4: the metrics target keeps its value.
      expect(onLaunch).toHaveBeenCalledTimes(1)
      expect(onLaunch).toHaveBeenCalledWith(service, 'documentation', false)
    })

    it.each(['grid', 'list'] as const)('sits in the tab order after the tile link and before the star, and takes Enter and Space (%s)', async (layout) => {
      const user = userEvent.setup()
      const onLaunch = vi.fn()
      const onToggle = vi.fn()
      render(
        <Tile
          service={service}
          categories={categories}
          locale="de"
          layout={layout}
          favorited={false}
          onToggleFavorite={onToggle}
          onLaunch={onLaunch}
        />,
      )
      await user.tab()
      expect(screen.getByRole('link', { name: /MyShare/ })).toHaveFocus()
      await user.tab()
      const help = screen.getByRole('button', { name: GUIDE_NAME_DE })
      expect(help).toHaveFocus()
      // The focus ring is the shared IconButton one (docs/03 §8).
      expect(help.className).toContain('focus-visible:ring-2')
      await user.tab()
      expect(screen.getByRole('button', { name: /zu Favoriten hinzufügen/ })).toHaveFocus()

      help.focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')
      expect(open).toHaveBeenCalledTimes(2)
      expect(onLaunch).toHaveBeenCalledTimes(2)
      expect(onLaunch).not.toHaveBeenCalledWith(service, undefined, expect.anything())
      expect(onToggle).not.toHaveBeenCalled()
    })

    it.each(['grid', 'list'] as const)('is immediately left of the star in the DOM (%s)', (layout) => {
      render(<Tile service={service} categories={categories} locale="de" layout={layout} onToggleFavorite={() => {}} />)
      const help = screen.getByRole('button', { name: GUIDE_NAME_DE })
      const star = screen.getByRole('button', { name: /Favoriten/ })
      expect(help.parentElement).toBe(star.parentElement)
      expect(help.nextElementSibling).toBe(star)
    })

    it('leaves the grid footer with only the category label, at the old footer height', () => {
      render(<Tile service={service} categories={categories} locale="de" onToggleFavorite={() => {}} />)
      const label = screen.getByText('Netz & Daten')
      const footer = label.parentElement!
      expect(footer.textContent).toBe('Netz & Daten')
      expect(within(footer).queryAllByRole('link')).toHaveLength(0)
      expect(within(footer).queryAllByRole('button')).toHaveLength(0)
      // The card is height:100% in a grid; a footer that lost its 26px pill
      // (16px text-xs line + 2×4px padding + 2×1px border) would reflow the row.
      expect(footer).toHaveStyle({ minHeight: '26px' })
    })

    it.each(['grid', 'list'] as const)('has no axe violations (%s)', async (layout) => {
      const { container } = render(
        <Tile
          service={service}
          categories={categories}
          locale="de"
          layout={layout}
          onToggleFavorite={() => {}}
          onLaunch={() => {}}
        />,
      )
      await expectNoAxeViolations(container)
    })
  })

  it('has no axe violations with all controls', async () => {
    const { container } = render(
      <Tile service={service} categories={categories} locale="de" onToggleFavorite={() => {}} onLaunch={() => {}} />,
    )
    await expectNoAxeViolations(container)
  })
})
