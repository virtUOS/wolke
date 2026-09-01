import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { PillButton } from '@/components/ui/pill-button'
import { Select } from '@/components/ui/select'

// Guards the UI-primitive convention (src/components/ui/README.md, rule #1):
// primitives are pure presentation and must never fetch or own server state.
// Data lives in containers (Dashboard.tsx is the single fetch root). This keeps
// the set coherent and cleanly portable to Claude Design as it grows in Phase C.
const uiDir = path.resolve(process.cwd(), 'src/components/ui')

function primitiveSources(): { name: string; src: string }[] {
  return readdirSync(uiDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ name: f, src: readFileSync(path.join(uiDir, f), 'utf8') }))
}

describe('UI primitives stay presentational', () => {
  const files = primitiveSources()

  it('finds primitives to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('$name does not fetch or own server state', ({ src }) => {
    expect(src).not.toMatch(/@tanstack\/react-query/)
    expect(src).not.toMatch(/\buseQuery\b|\buseMutation\b|\buseQueryClient\b/)
    expect(src).not.toMatch(/\bfetch\s*\(/)
  })

  it.each(files)('$name imports only types from @/lib/api', ({ src }) => {
    // A runtime (non-type) import from the API client would mean the primitive
    // reaches for data/helpers it shouldn't. `import type { … } from '@/lib/api'`
    // is allowed; `import { … } from '@/lib/api'` is not.
    const runtimeApiImport = /import\s+(?!type\b)[^;]*from\s+['"]@\/lib\/api['"]/
    expect(src).not.toMatch(runtimeApiImport)
  })
})

// Issue #30: the section tabs (and every pill built on PillButton — category
// filters, view-mode switches) navigate like links, so they get a pointer
// cursor like one. A disabled pill (there aren't any today, but the variant is
// supported) must not claim to be clickable.
describe('PillButton cursor affordance (issue #30)', () => {
  it('carries a pointer cursor', () => {
    const { getByRole } = render(<PillButton>Alle</PillButton>)
    expect(getByRole('button').className).toMatch(/\bcursor-pointer\b/)
  })

  it('a disabled pill does not get a pointer cursor', () => {
    const { getByRole } = render(<PillButton disabled>Alle</PillButton>)
    const el = getByRole('button')
    expect(el.className).toMatch(/\bcursor-pointer\b/) // base class is still present…
    expect(el.className).toMatch(/\bdisabled:cursor-default\b/) // …but overridden when disabled
  })
})

// Issue #101: the admin surface sat below the 44px touch floor because the
// shared primitives did. The geometry itself is asserted in the browser
// (e2e/admin-viewport.spec.ts, every matrix resolution); what this pins is the
// *convention* those fixes established, so a new size variant can't quietly
// ship without it: a phone-width floor plus an `md:` escape back to pointer
// density (md: is the app's one mobile/desktop breakpoint — src/lib/breakpoints.ts).
describe('interactive primitives carry the phone touch floor (issue #101)', () => {
  const cases: { name: string; render: () => void; role: string; floor: RegExp }[] = [
    { name: 'Button (default)', render: () => render(<Button>Speichern</Button>), role: 'button', floor: /\bh-11\b/ },
    { name: 'Button (sm)', render: () => render(<Button size="sm">Neu</Button>), role: 'button', floor: /\bh-11\b/ },
    {
      name: 'Button (icon)',
      render: () => render(<Button size="icon" aria-label="x" />),
      role: 'button',
      floor: /\bh-11 w-11\b/,
    },
    {
      name: 'IconButton (md)',
      render: () =>
        render(
          <IconButton aria-label="x">
            <X />
          </IconButton>,
        ),
      role: 'button',
      floor: /\bh-11 w-11\b/,
    },
    {
      name: 'IconButton (sm)',
      render: () =>
        render(
          <IconButton aria-label="x" size="sm">
            <X />
          </IconButton>,
        ),
      role: 'button',
      floor: /\bh-11 w-11\b/,
    },
    { name: 'PillButton', render: () => render(<PillButton>Alle</PillButton>), role: 'button', floor: /\bmin-h-11\b/ },
    { name: 'Input', render: () => render(<Input aria-label="x" />), role: 'textbox', floor: /\bmin-h-11\b/ },
    { name: 'Select', render: () => render(<Select aria-label="x" />), role: 'combobox', floor: /\bh-11\b/ },
  ]

  it.each(cases)('$name meets the floor and hands back to md:', ({ render: renderIt, role, floor }) => {
    renderIt()
    const className = screen.getByRole(role).className
    expect(className).toMatch(floor)
    expect(className).toMatch(/\bmd:(h|w|min-h)-/)
  })

  // Checkbox is the exception that proves the rule: the box stays a box and its
  // label is the hit area (see checkbox.tsx).
  it('Checkbox puts the floor on the label, not the box', () => {
    render(<Checkbox label="Ausblendbar" />)
    expect(screen.getByText('Ausblendbar').className).toMatch(/\bmin-h-11\b/)
  })
})
