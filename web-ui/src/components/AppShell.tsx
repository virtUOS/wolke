import { Sparkles } from 'lucide-react'
import type { Branding } from '@/lib/branding'

// The empty themed shell for Phase 0: a branded top bar and a placeholder main
// region. The persistent nav (Services/Favorites), tile grid, search, and theme
// toggle arrive in Phase 1 (docs/01 §4). The red bar to the left of the title is
// the page-title motif (docs/03 §3).
export function AppShell({ branding }: { branding: Branding }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex h-14 items-center gap-3 border-b border-surface px-4">
        <picture>
          <source srcSet={branding.logo_dark} media="(prefers-color-scheme: dark)" />
          <img src={branding.logo_light} alt={branding.product_name} className="h-7" />
        </picture>
        <nav aria-label="Hauptnavigation" className="ml-auto" />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="inline-block h-7 w-1.5 rounded bg-primary" />
          <h1 className="text-2xl font-bold">{branding.product_name}</h1>
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-text/70">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
          Gerüst läuft. Anmeldung und Katalog folgen in Phase 1.
        </p>
      </main>
    </div>
  )
}
