import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { api, type Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAdminActions } from '@/lib/admin-hooks'
import { useCatalog } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { PillButton } from '@/components/ui/pill-button'
import { Select } from '@/components/ui/select'

const ROLES = ['student', 'teacher', 'staff'] as const

// Per-role ordered default view editor (docs/01 §3): pick services and order
// them; Save replaces the role's defaults.
export function RoleDefaultsAdmin({ locale }: { locale: string }) {
  const s = t(locale)
  const catalog = useCatalog()
  const actions = useAdminActions()
  const [role, setRole] = useState<(typeof ROLES)[number]>('student')
  const [ordered, setOrdered] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const services = catalog.data?.services ?? []
  const byID = new Map(services.map((s) => [s.id, s]))
  const name = (id: string) => byID.get(id)?.name ?? id

  useEffect(() => {
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
      <div className="flex gap-1">
        {ROLES.map((r) => (
          <PillButton
            key={r}
            active={role === r}
            aria-current={role === r ? 'true' : undefined}
            onClick={() => { setRole(r); setSaved(false); setError(undefined) }}
          >
            {r}
          </PillButton>
        ))}
      </div>

      <ol className="space-y-1">
        {ordered.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-md border border-surface px-2 py-1 text-sm">
            <span className="flex-1">{i + 1}. {name(id)}</span>
            <button type="button" aria-label={`${s.admin.moveUp} – ${name(id)}`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-text-muted hover:bg-surface disabled:opacity-30">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`${s.admin.moveDown} – ${name(id)}`} disabled={i === ordered.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-text-muted hover:bg-surface disabled:opacity-30">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`${s.admin.remove} – ${name(id)}`} onClick={() => remove(id)} className="rounded p-1 text-text-muted hover:text-primary">
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
          disabled={actions.setRoleDefaults.isPending}
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
