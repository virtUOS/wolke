import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { api, localized, type Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions } from '@/lib/admin-hooks'
import { useCatalog, useRoles } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
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

  useEffect(() => {
    if (!role) return
    let active = true
    api.roleDefaults(role).then((r) => active && setOrdered(r.service_ids.filter((id) => byID.has(id))))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, catalog.data])

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= ordered.length) return
    const next = [...ordered]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrdered(next)
  }
  const remove = (id: string) => setOrdered((o) => o.filter((x) => x !== id))
  const add = (id: string) => setOrdered((o) => (o.includes(id) ? o : [...o, id]))

  const available = services.filter((s: Service) => !ordered.includes(s.id))

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
        {ordered.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-md border border-surface px-2 py-1 text-sm">
            <span className="flex-1">{i + 1}. {name(id)}</span>
            <button type="button" aria-label={`${s.admin.moveUp} – ${name(id)}`} disabled={i === 0} onClick={() => move(i, -1)} className="cursor-pointer rounded p-1 text-text-muted hover:bg-surface disabled:cursor-default disabled:opacity-30">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`${s.admin.moveDown} – ${name(id)}`} disabled={i === ordered.length - 1} onClick={() => move(i, 1)} className="cursor-pointer rounded p-1 text-text-muted hover:bg-surface disabled:cursor-default disabled:opacity-30">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`${s.admin.remove} – ${name(id)}`} onClick={() => remove(id)} className="cursor-pointer rounded p-1 text-text-muted hover:text-primary">
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
        {ordered.length === 0 && <li className="text-sm text-text-muted">{s.admin.noRoleDefaults}</li>}
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
              { role, serviceIDs: ordered },
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
