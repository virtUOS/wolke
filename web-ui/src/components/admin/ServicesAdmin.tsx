import { useEffect, useRef, useState } from 'react'
import { type AdminService, type Category } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions, useAdminServices } from '@/lib/admin-hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { List, ListItem } from '@/components/ui/list'
import { ServiceForm } from './ServiceForm'

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; service: AdminService }

export function ServicesAdmin({ categories, locale }: { categories: Category[]; locale: string }) {
  const s = t(locale)
  const services = useAdminServices()
  const actions = useAdminActions()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | undefined>()

  // When the form closes back to the list, return focus to the list heading so
  // it isn't lost to <body>.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const prevKind = useRef(mode.kind)
  useEffect(() => {
    if (prevKind.current !== 'list' && mode.kind === 'list') headingRef.current?.focus()
    prevKind.current = mode.kind
  }, [mode.kind])

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
          const onError = (e: unknown) => setFormError(e instanceof Error ? e.message : s.admin.saveFailed)
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
        <h2 ref={headingRef} tabIndex={-1} className="focus:outline-hidden" style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.servicesHeading}</h2>
        <Button size="sm" onClick={() => setMode({ kind: 'new' })}>{s.admin.newService}</Button>
      </div>

      {services.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">{s.common.loading}</p>
      ) : (
        <List>
          {list.map((svc) => (
            <ListItem key={svc.id}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{svc.name}</span>
                {!svc.is_active && <Badge className="ml-2">{s.admin.inactive}</Badge>}
              </span>
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="border-border" onClick={() => setMode({ kind: 'edit', service: svc })}>{s.common.edit}</Button>
                {svc.is_active && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border hover:border-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg))] hover:text-danger"
                    onClick={() => setConfirmDelete(svc.id)}
                  >
                    {s.common.delete}
                  </Button>
                )}
              </span>
            </ListItem>
          ))}
          {list.length === 0 && <ListItem className="text-sm text-text-muted">{s.admin.noServices}</ListItem>}
        </List>
      )}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={s.admin.deleteServiceTitle}
        description={s.admin.deleteServiceDesc(pendingDelete?.name ?? '')}
        closeLabel={s.common.close}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {s.common.cancel}
            </Button>
            <Button
              onClick={() =>
                confirmDelete && actions.deleteService.mutate(confirmDelete, { onSettled: () => setConfirmDelete(null) })
              }
            >
              {s.common.delete}
            </Button>
          </>
        }
      />
    </div>
  )
}
