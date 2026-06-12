import { Settings } from 'lucide-react'
import type { Me } from '@/lib/api'

interface SettingsMenuProps {
  order: Me['favorites_order']
  separateTab: boolean
  onChangeOrder: (order: Me['favorites_order']) => void
  onChangeSeparateTab: (on: boolean) => void
}

// A lightweight settings disclosure (native <details>, no extra dependency) for
// the favorites preferences (concept §4.4).
export function SettingsMenu({ order, separateTab, onChangeOrder, onChangeSeparateTab }: SettingsMenuProps) {
  return (
    <details className="group relative">
      <summary
        aria-label="Einstellungen"
        title="Einstellungen"
        className="flex cursor-pointer list-none items-center rounded-md p-2 text-text-muted hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] [&::-webkit-details-marker]:hidden"
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </summary>

      <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-surface bg-bg p-3 text-sm shadow-lg">
        <fieldset>
          <legend className="mb-1 font-medium text-text">Favoriten sortieren</legend>
          <label className="flex items-center gap-2 py-0.5">
            <input
              type="radio"
              name="favorites-order"
              checked={order === 'usage'}
              onChange={() => onChangeOrder('usage')}
            />
            Nach Nutzung
          </label>
          <label className="flex items-center gap-2 py-0.5">
            <input
              type="radio"
              name="favorites-order"
              checked={order === 'alpha'}
              onChange={() => onChangeOrder('alpha')}
            />
            Alphabetisch
          </label>
        </fieldset>

        <label className="mt-3 flex items-center gap-2 border-t border-surface pt-3">
          <input type="checkbox" checked={separateTab} onChange={(e) => onChangeSeparateTab(e.target.checked)} />
          Favoriten in eigenem Tab
        </label>
      </div>
    </details>
  )
}
