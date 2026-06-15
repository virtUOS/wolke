import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
