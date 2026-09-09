import { useEffect, useRef, useState } from 'react'
import { localized, type AdminService, type Category } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions, useAdminServices } from '@/lib/admin-hooks'
import { useMe } from '@/lib/hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { List, ListItem } from '@/components/ui/list'
import { RestrictedMarker } from '@/components/ui/restricted-marker'
import { ServiceForm } from './ServiceForm'

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; service: AdminService }

export function ServicesAdmin({
  categories,
  categoriesReady,
  locale,
}: {
  categories: Category[]
  /** Whether GET /api/admin/categories has actually answered. The restriction
   *  marker is derived from that list, so rendering before it lands would flash
   *  "public" onto a restricted service — the loading-state trap this feature
   *  hit twice already. */
  categoriesReady: boolean
  locale: string
}) {
  const s = t(locale)
  const services = useAdminServices()
  const actions = useAdminActions()
  // The configured visibility groups ride on /api/me (labels for the list, the
  // selector's options for the form).
  const me = useMe()
  const visibilityOptions = me.data?.visibility.entries ?? []
  const visibilityLabel = (slug: string) =>
    localized(visibilityOptions.find((v) => v.slug === slug)?.label, locale) || slug
  // A service is restricted by the categories it sits in, so the marker is
  // derived from them (docs/specs/service-visibility.md §2.2). The categories
  // come in unnarrowed from GET /api/admin/categories.
  //
  // One marker per row, never one per category: a service in two restricted
  // categories is not "more restricted", and the row is a scanning surface —
  // what matters at a glance is that it is not public. The groups are named
  // together in the one marker (and in full on the service's own form), so
  // nothing is hidden by collapsing them.
  const restrictingGroups = (svc: { categories: string[] }): string[] => {
    if (!categoriesReady) return []
    const labels: string[] = []
    for (const slug of svc.categories) {
      const group = categories.find((c) => c.slug === slug)?.visibility
      if (!group) continue
      const label = visibilityLabel(group)
      if (!labels.includes(label)) labels.push(label)
    }
    return labels
  }
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
        visibilityOptions={visibilityOptions}
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
            <ListItem key={svc.id} className="flex-wrap">
              {/* A floor on the text column, like the category rows: the name
                  plus a marker naming its group does not fit beside two
                  fixed-width buttons at 324px, and the name must not pay for
                  the buttons (CLAUDE.md, "Responsive & viewport discipline") —
                  the button group wraps to its own line instead. */}
              <span className="min-w-24 flex-1 hyphenate-compound">
                <span className="font-medium">{svc.name}</span>
                {restrictingGroups(svc).length > 0 && (
                  <RestrictedMarker
                    className="ml-2"
                    label={restrictingGroups(svc).join(', ')}
                    srLabel={s.common.restrictedTo(restrictingGroups(svc).join(', '))}
                  />
                )}
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
