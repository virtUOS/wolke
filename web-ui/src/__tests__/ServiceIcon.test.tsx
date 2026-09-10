import { lazy } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { AppWindow } from 'lucide-react'
import { LazyIconBoundary, ServiceIcon } from '@/lib/icons'

// Issue #150: after a redeploy a client can still hold an index.html pointing at
// a hashed chunk the server no longer has, so the lazy full-icon import fails.
// Suspense covers only the *pending* state — a failed load throws during render,
// and without a boundary React unmounts the tree and the dashboard goes blank.
//
// The mock makes reading full-icon's default export throw, which is where React's
// lazyInitializer lands for a rejected import too (it rethrows the rejection at
// exactly that point). A mock factory that rejects outright can't be used: Vitest
// reports that as an unhandled error and fails the run on its own.
vi.mock('@/lib/full-icon', () => ({
  get default(): never {
    throw new Error('error loading dynamically imported module: /assets/icon-set-DeL2hHwx.js')
  },
}))

describe('ServiceIcon', () => {
  beforeEach(() => {
    // React reports a boundary-caught error through console.error; the point of
    // these tests is that it stays caught, so keep the run's output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders a curated icon synchronously, without the lazy chunk', () => {
    const { container } = render(<ServiceIcon name="wifi" />)
    expect(container.querySelector('.lucide-wifi')).toBeInTheDocument()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('falls back to app-window when the lazy chunk fails, instead of blanking the tree', async () => {
    const { container } = render(<ServiceIcon name="rocket" className="tile-icon" />)

    // Flush the failed import, so what's asserted below is the boundary's
    // fallback and not Suspense's — deliberately the same glyph. Unhandled, the
    // failure surfaces here.
    await act(async () => {})

    expect(container.querySelector('.lucide-app-window')).toBeInTheDocument()
    // The fallback takes the caller's props, so a missing icon costs a glyph and
    // not the tile's layout.
    expect(container.querySelector('svg')).toHaveClass('tile-icon')
  })

  it('keeps a failed chunk cosmetic for the icons around it', async () => {
    const { container } = render(
      <div>
        <ServiceIcon name="wifi" />
        <ServiceIcon name="rocket" />
        <ServiceIcon name="mail" />
      </div>,
    )

    await waitFor(() => expect(container.querySelector('.lucide-app-window')).toBeInTheDocument())
    expect(container.querySelector('.lucide-wifi')).toBeInTheDocument()
    expect(container.querySelector('.lucide-mail')).toBeInTheDocument()
  })
})

// The genuinely rejected dynamic import, straight through the boundary — the
// shape Vitest's module mocker can't express.
describe('LazyIconBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders the fallback for an import that rejects, and does not rethrow', async () => {
    const Gone = lazy(() => Promise.reject(new Error('error loading dynamically imported module')))
    const { container } = render(
      <LazyIconBoundary fallback={<AppWindow className="fallback-icon" />}>
        <Gone />
      </LazyIconBoundary>,
    )

    await waitFor(() => expect(container.querySelector('.fallback-icon')).toBeInTheDocument())
  })

  it('renders its children untouched while nothing fails', () => {
    const { container } = render(
      <LazyIconBoundary fallback={<AppWindow className="fallback-icon" />}>
        <span>fine</span>
      </LazyIconBoundary>,
    )
    expect(container.querySelector('.fallback-icon')).not.toBeInTheDocument()
    expect(container.textContent).toBe('fine')
  })
})
