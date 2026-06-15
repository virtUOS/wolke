import { useAudit } from '@/lib/admin-hooks'

// Read-only audit trail (docs/01 §5.5): who changed what, when.
export function AuditLog() {
  const audit = useAudit()
  const entries = audit.data?.entries ?? []

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Audit-Log</h2>
      {audit.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">Lädt…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">Keine Einträge.</p>
      ) : (
        <ul className="divide-y divide-surface rounded-md border border-surface text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-mono text-xs text-text-muted">{e.created_at.slice(0, 19).replace('T', ' ')}</span>
              <span className="rounded bg-surface px-1.5 py-0.5 text-xs">{e.actor_kind}</span>
              <span className="font-medium">{e.action}</span>
              {e.target_id && <span className="font-mono text-xs text-text-muted">{e.target_id.slice(0, 8)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
