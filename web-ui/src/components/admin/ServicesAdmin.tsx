import { useState } from 'react'
import { type AdminService, type Category } from '@/lib/api'
import { useAdminActions, useAdminServices } from '@/lib/admin-hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { List, ListItem } from '@/components/ui/list'
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
        key={initial?.id ?? 'new'}
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
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Dienste</h2>
        <Button size="sm" onClick={() => setMode({ kind: 'new' })}>Neuer Dienst</Button>
      </div>

      {services.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">Lädt…</p>
      ) : (
        <List>
          {list.map((s) => (
            <ListItem key={s.id}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                {!s.is_active && <Badge className="ml-2">inaktiv</Badge>}
                <span className="ml-2 text-xs text-text-muted">{s.categories.join(', ')}</span>
              </span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'edit', service: s })}>Bearbeiten</Button>
                {s.is_active && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(s.id)}>Löschen</Button>
                )}
              </span>
            </ListItem>
          ))}
          {list.length === 0 && <ListItem className="text-sm text-text-muted">Keine Dienste.</ListItem>}
        </List>
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
