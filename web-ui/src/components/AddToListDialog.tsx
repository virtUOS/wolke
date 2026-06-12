import { useState } from 'react'
import type { FavoriteList, Service } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

interface AddToListDialogProps {
  service: Service | null
  lists: FavoriteList[]
  onClose: () => void
  onAddToExisting: (listID: string) => void
  onCreateAndAdd: (name: string) => void
}

// The deliberate "add to list…" flow (docs/01 §4.4): pick an existing list or
// create a new one inline. Built on the accessible Radix dialog.
export function AddToListDialog({ service, lists, onClose, onAddToExisting, onCreateAndAdd }: AddToListDialogProps) {
  const [selected, setSelected] = useState('')
  const [newName, setNewName] = useState('')
  const open = service !== null

  const close = () => {
    setSelected('')
    setNewName('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent aria-describedby="add-to-list-desc">
        <DialogHeader>
          <DialogTitle>Zu Liste hinzufügen</DialogTitle>
          <DialogDescription id="add-to-list-desc">
            {service ? `„${service.name}" in einer deiner Listen ablegen.` : ''}
          </DialogDescription>
        </DialogHeader>

        {lists.length > 0 && (
          <form
            className="mb-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (selected) {
                onAddToExisting(selected)
                close()
              }
            }}
          >
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-text-muted">Bestehende Liste</span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="h-9 w-full rounded-md border border-surface bg-surface px-2 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <option value="">Liste wählen…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!selected}
              className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              Hinzufügen
            </button>
          </form>
        )}

        <form
          className="flex items-end gap-2 border-t border-surface pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newName.trim()
            if (name) {
              onCreateAndAdd(name)
              close()
            }
          }}
        >
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-text-muted">Neue Liste</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z. B. Täglicher Gebrauch"
              maxLength={60}
              className="h-9 w-full rounded-md border border-surface bg-surface px-2 text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={newName.trim() === ''}
            className="h-9 rounded-md border border-surface px-3 text-sm font-medium text-text hover:bg-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            Erstellen
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
