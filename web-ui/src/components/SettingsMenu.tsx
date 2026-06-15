import { Settings } from 'lucide-react'
import type { Me } from '@/lib/api'
import { Popover } from '@/components/ui/popover'

interface SettingsMenuProps {
  order: Me['favorites_order']
  separateTab: boolean
  onChangeOrder: (order: Me['favorites_order']) => void
  onChangeSeparateTab: (on: boolean) => void
}

// The favorites-preferences panel (concept §4.4), in a Popover — a floating panel
// of form controls, dismissed by Escape/outside-click with focus returned.
export function SettingsMenu({ order, separateTab, onChangeOrder, onChangeSeparateTab }: SettingsMenuProps) {
  return (
    <Popover label="Einstellungen" icon={<Settings className="h-5 w-5" aria-hidden="true" />} panelClassName="w-64">
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

      <label className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <input type="checkbox" checked={separateTab} onChange={(e) => onChangeSeparateTab(e.target.checked)} />
        Favoriten in eigenem Tab
      </label>
    </Popover>
  )
}
