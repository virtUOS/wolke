import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { api, localized, type Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions } from '@/lib/admin-hooks'
import { useCatalog, useRoles } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { Select } from '@/components/ui/select'

// Per-role ordered default view editor (docs/01 §3): pick services and order
// them; Save replaces the role's defaults. The roles come from /api/roles —
// they are whatever this deployment's claim mapping defines, so the tab strip
// wraps rather than assuming a fixed number of them.
export function RoleDefaultsAdmin({ locale }: { locale: string }) {
  const s = t(locale)
  const catalog = useCatalog()
  const roles = useRoles()
  const actions = useAdminActions()
  const roleList = roles.data ?? []
  // Empty until /api/roles resolves; the first role in precedence order is the
  // one an admin lands on. A selection that the configured set no longer
  // contains (the roles query refetched after a config change) falls back to
  // that first role, so the editor never saves under a role that is gone.
  const [selected, setSelected] = useState('')
  const role = roleList.some((r) => r.slug === selected) ? selected : roleList[0]?.slug ?? ''
  const [ordered, setOrdered] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const services = catalog.data?.services ?? []
  const byID = new Map(services.map((s) => [s.id, s]))
  const name = (id: string) => byID.get(id)?.name ?? id

  // True once the admin has touched the list since the current fetch started.
  // The fetch is not instant, and the picker is usable while it is in flight, so
  // an add made in that window must not be thrown away when the response lands.
  const edited = useRef(false)

  // Load the selected role's defaults. Keyed on `role` alone: keying it on
  // catalog.data as well meant every catalog refetch re-ran the fetch and
  // replaced the list under the admin's hands.
  useEffect(() => {
    if (!role) return
    let active = true
    edited.current = false
    api.roleDefaults(role).then((r) => {
      if (!active) return
      setOrdered((prev) => {
        // No local edits: the server's list is the list.
        if (!edited.current) return r.service_ids
        // Otherwise the server's list is the base and the local edits sit on
        // top of it — the admin's own change stays visible, and nothing the
        // server already had is silently dropped from the list they will save.
        return [...r.service_ids.filter((id) => !prev.includes(id)), ...prev]
      })
    })
    return () => {
      active = false
    }
  }, [role])

  // A service that has since left the catalog would render as a bare id, so it
  // is filtered out of the view — and of what Save writes — rather than out of
  // state. Derived, not stored: no effect to race with a local edit, and no
  // dependency on the catalog arriving before the defaults do.
  const visible = catalog.data ? ordered.filter((id) => byID.has(id)) : ordered

  // The row indices the buttons pass in are indices into `visible`, so a swap
  // is translated back onto the stored list.
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= visible.length) return
    edited.current = true
    const a = ordered.indexOf(visible[i])
    const b = ordered.indexOf(visible[j])
    const next = [...ordered]
    ;[next[a], next[b]] = [next[b], next[a]]
    setOrdered(next)
  }
  const remove = (id: string) => {
    edited.current = true
    setOrdered((o) => o.filter((x) => x !== id))
  }
  const add = (id: string) => {
    edited.current = true
    setOrdered((o) => (o.includes(id) ? o : [...o, id]))
  }

  const available = services.filter((s: Service) => !visible.includes(s.id))

  return (
    <div className="space-y-4">
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.rolesHeading}</h2>
      <div className="flex flex-wrap gap-1">
        {roleList.map((r) => (
          <PillButton
            key={r.slug}
            active={role === r.slug}
            aria-current={role === r.slug ? 'true' : undefined}
            onClick={() => { setSelected(r.slug); setSaved(false); setError(undefined) }}
          >
            {localized(r.label, locale)}
          </PillButton>
        ))}
      </div>

      <ol className="space-y-1">
        {visible.map((id, i) => (
          // The three row actions are IconButtons rather than hand-rolled
          // buttons, so they inherit the shared 44px phone touch floor (issue
          // #101) instead of the 24px boxes they used to be.
          <li key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-surface px-2 py-1 text-sm">
            <span className="min-w-0 flex-1 break-words hyphens-auto">{i + 1}. {name(id)}</span>
            <IconButton size="sm" aria-label={`${s.admin.moveUp} – ${name(id)}`} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30">
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton size="sm" aria-label={`${s.admin.moveDown} – ${name(id)}`} disabled={i === visible.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton size="sm" variant="plain" aria-label={`${s.admin.remove} – ${name(id)}`} onClick={() => remove(id)} className="hover:text-primary">
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
        {visible.length === 0 && <li className="text-sm text-text-muted">{s.admin.noRoleDefaults}</li>}
      </ol>

      {available.length > 0 && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{s.admin.add}</span>
          <Select value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">{s.admin.chooseService}</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button
          disabled={!role || actions.setRoleDefaults.isPending}
          onClick={() => {
            setError(undefined)
            actions.setRoleDefaults.mutate(
              // `visible`, not `ordered`: an id the catalog no longer knows is
              // not shown, so it must not be silently re-saved either.
              { role, serviceIDs: visible },
              {
                onSuccess: () => setSaved(true),
                onError: (e) => setError(e instanceof Error ? e.message : s.admin.saveFailed),
              },
            )
          }}
        >
          {s.common.save}
        </Button>
        {saved && <span className="text-sm text-text-muted" role="status">{s.admin.saved}</span>}
        {error && <span className="text-sm text-danger" role="alert">{error}</span>}
      </div>
    </div>
  )
}
