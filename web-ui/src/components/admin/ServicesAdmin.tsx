import { useState } from 'react'
import { type AdminService, type Category } from '@/lib/api'
import { useAdminActions, useAdminServices } from '@/lib/admin-hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ServiceForm } from './ServiceForm'

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; service: AdminService }

export function ServicesAdmin({ categories, locale }: { categories: Category[]; locale: string }) {
  const services = useAdminServices()
  const actions = useAdminActions()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | undefined>()

  if (mode.kind !== 'list') {
    const initial = mode.kind === 'edit' ? mode.service : undefined
    return (
      <ServiceForm
        categories={categories}
        locale={locale}
        initial={initial}
        error={formError}
        submitting={actions.createService.isPending || actions.updateService.isPending}
        onCancel={() => {
          setFormError(undefined)
          setMode({ kind: 'list' })
        }}
        onSubmit={(draft) => {
          setFormError(undefined)
          const onError = (e: unknown) => setFormError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
          const onDone = () => setMode({ kind: 'list' })
          if (initial) {
            actions.updateService.mutate({ id: initial.id, draft }, { onSuccess: onDone, onError })
          } else {
            actions.createService.mutate(draft, { onSuccess: onDone, onError })
          }
        }}
      />
    )
  }

  const list = services.data?.services ?? []
  const pendingDelete = list.find((s) => s.id === confirmDelete)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dienste</h2>
        <button
          onClick={() => setMode({ kind: 'new' })}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          Neuer Dienst
        </button>
      </div>

      {services.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">Lädt…</p>
      ) : (
        <ul className="divide-y divide-surface rounded-md border border-surface">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                {!s.is_active && <Badge className="ml-2">inaktiv</Badge>}
                <span className="ml-2 text-xs text-text-muted">{s.categories.join(', ')}</span>
              </span>
              <span className="flex items-center gap-2">
                <button onClick={() => setMode({ kind: 'edit', service: s })} className="text-sm text-primary hover:text-primary-hover">
                  Bearbeiten
                </button>
                {s.is_active && (
                  <button onClick={() => setConfirmDelete(s.id)} className="text-sm text-text-muted hover:text-primary">
                    Löschen
                  </button>
                )}
              </span>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">Keine Dienste.</li>}
        </ul>
      )}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Dienst löschen?"
        description={`„${pendingDelete?.name ?? ''}" wird deaktiviert und verschwindet aus dem Katalog.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Abbrechen
            </Button>
            <Button
              onClick={() =>
                confirmDelete && actions.deleteService.mutate(confirmDelete, { onSettled: () => setConfirmDelete(null) })
              }
            >
              Löschen
            </Button>
          </>
        }
      />
    </div>
  )
}
