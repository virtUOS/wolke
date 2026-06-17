import { useAudit } from '@/lib/admin-hooks'
import { List, ListItem } from '@/components/ui/list'
import { Badge } from '@/components/ui/badge'

// Read-only audit trail (docs/01 §5.5): who changed what, when.
export function AuditLog() {
  const audit = useAudit()
  const entries = audit.data?.entries ?? []

  return (
    <div className="space-y-4">
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Audit-Log</h2>
      {audit.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">Lädt…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">Keine Einträge.</p>
      ) : (
        <List className="text-sm">
          {entries.map((e) => (
            <ListItem key={e.id} className="flex-wrap gap-2">
              <span className="font-mono text-xs text-text-muted">{e.created_at.slice(0, 19).replace('T', ' ')}</span>
              <Badge>{e.actor_kind}</Badge>
              <span className="font-medium">{e.action}</span>
              {e.target_id && <span className="font-mono text-xs text-text-muted">{e.target_id.slice(0, 8)}</span>}
            </ListItem>
          ))}
        </List>
      )}
    </div>
  )
}
