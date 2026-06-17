import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { api, type Service } from '@/lib/api'
import { useAdminActions } from '@/lib/admin-hooks'
import { useCatalog } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { PillButton } from '@/components/ui/pill-button'
import { Select } from '@/components/ui/select'

const ROLES = ['student', 'teacher', 'staff'] as const

// Per-role ordered default view editor (docs/01 §3): pick services and order
// them; Save replaces the role's defaults.
export function RoleDefaultsAdmin() {
  const catalog = useCatalog()
  const actions = useAdminActions()
  const [role, setRole] = useState<(typeof ROLES)[number]>('student')
  const [ordered, setOrdered] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

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
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Rollen-Standardansicht</h2>
      <div className="flex gap-1">
        {ROLES.map((r) => (
          <PillButton
            key={r}
            active={role === r}
            aria-current={role === r ? 'true' : undefined}
            onClick={() => { setRole(r); setSaved(false) }}
          >
            {r}
          </PillButton>
        ))}
      </div>

      <ol className="space-y-1">
        {ordered.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-md border border-surface px-2 py-1 text-sm">
            <span className="flex-1">{i + 1}. {name(id)}</span>
            <button aria-label="Nach oben" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-text-muted hover:bg-surface disabled:opacity-30">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button aria-label="Nach unten" disabled={i === ordered.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-text-muted hover:bg-surface disabled:opacity-30">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button aria-label="Entfernen" onClick={() => remove(id)} className="rounded p-1 text-text-muted hover:text-primary">
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
        {ordered.length === 0 && <li className="text-sm text-text-muted">Keine Standarddienste für diese Rolle.</li>}
      </ol>

      {available.length > 0 && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Hinzufügen</span>
          <Select value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">Dienst wählen…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </label>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => actions.setRoleDefaults.mutate({ role, serviceIDs: ordered }, { onSuccess: () => setSaved(true) })}>
          Speichern
        </Button>
        {saved && <span className="text-sm text-text-muted" role="status">Gespeichert.</span>}
      </div>
    </div>
  )
}
