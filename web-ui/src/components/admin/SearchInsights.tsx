import { t } from '@/lib/i18n'
import { useSearchInsights } from '@/lib/admin-hooks'
import { List, ListItem } from '@/components/ui/list'
import { Badge } from '@/components/ui/badge'

// Read-only view of searches that returned nothing (docs/01 §4.6): the worklist
// for adding service keywords. Aggregate-only — no per-user data.
export function SearchInsights({ locale }: { locale: string }) {
  const s = t(locale)
  const insights = useSearchInsights()
  const entries = insights.data?.entries ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{s.admin.insightsHeading}</h2>
        <p className="mt-1 text-sm text-text-muted">{s.admin.insightsHint}</p>
      </div>
      {insights.isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">{s.common.loading}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">{s.admin.insightsEmpty}</p>
      ) : (
        <List className="text-sm">
          {entries.map((e) => (
            <ListItem key={e.query} className="flex-wrap items-center gap-2">
              <Badge>{e.searches}×</Badge>
              <span className="font-medium">{e.query}</span>
              <span className="ml-auto font-mono text-xs text-text-muted">
                {e.last_seen.slice(0, 10)}
              </span>
            </ListItem>
          ))}
        </List>
      )}
    </div>
  )
}
