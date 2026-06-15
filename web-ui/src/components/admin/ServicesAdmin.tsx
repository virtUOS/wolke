import { useState } from 'react'
import { type AdminService, type Category } from '@/lib/api'
import { useAdminActions, useAdminServices } from '@/lib/admin-hooks'
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
                {!s.is_active && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs text-text-muted">inaktiv</span>}
                <span className="ml-2 text-xs text-text-muted">{s.categories.join(', ')}</span>
              </span>
              {confirmDelete === s.id ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-text-muted">Löschen?</span>
                  <button
                    onClick={() => actions.deleteService.mutate(s.id, { onSettled: () => setConfirmDelete(null) })}
                    className="rounded-md bg-primary px-2 py-1 text-xs text-white hover:bg-primary-hover"
                  >
                    Ja
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="rounded-md border border-surface px-2 py-1 text-xs hover:bg-surface">
                    Nein
                  </button>
                </span>
              ) : (
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
              )}
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">Keine Dienste.</li>}
        </ul>
      )}
    </div>
  )
}
