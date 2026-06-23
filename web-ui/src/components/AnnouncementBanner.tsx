import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { localized, type Announcement, type Severity } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useDismissAnnouncement } from '@/lib/hooks'
import { Alert } from '@/components/ui/alert'
import type { alertVariants } from '@/components/ui/alert'
import type { VariantProps } from 'class-variance-authority'

// Role-scoped announcement banners (docs/01 §4.7, docs/03 §8): severity-colored,
// stacked, dismissible except critical, announced via an aria-live region. Each
// banner is an Alert primitive; this component owns the live region. Dismissals
// persist server-side (per user), so a closed banner stays gone across reloads.
export function AnnouncementBanner({ announcements, locale }: { announcements: Announcement[]; locale: string }) {
  const s = t(locale)
  const dismiss = useDismissAnnouncement()
  // The server already excludes dismissed announcements; the optimistic mutation
  // drops them from the cache immediately, so render the list as-is.
  const visible = announcements
  if (visible.length === 0) return null

  const renderAlert = (a: Announcement) => (
    <Alert
      key={a.id}
      variant={severityVariant(a.severity)}
      icon={severityIcon(a.severity)}
      title={localized(a.title, locale)}
      dismissLabel={s.announce.dismiss}
      onDismiss={a.dismissible && a.severity !== 'critical' ? () => dismiss.mutate(a.id) : undefined}
    >
      {localized(a.body, locale)}
    </Alert>
  )

  // Critical notices interrupt (assertive); everything else is announced
  // politely. Severity sort already places critical first, so the visual order
  // is unchanged.
  const critical = visible.filter((a) => a.severity === 'critical')
  const rest = visible.filter((a) => a.severity !== 'critical')

  return (
    <div role="region" aria-label={s.announce.region} className="space-y-2">
      <div aria-live="assertive" className="space-y-2">
        {critical.map(renderAlert)}
      </div>
      <div aria-live="polite" className="space-y-2">
        {rest.map(renderAlert)}
      </div>
    </div>
  )
}

// Severities map onto the feedback tokens (docs/03 §2): critical reads as danger.
function severityVariant(s: Severity): VariantProps<typeof alertVariants>['variant'] {
  if (s === 'critical') return 'danger'
  if (s === 'warning') return 'warning'
  return 'info'
}

function severityIcon(s: Severity) {
  const cls = 'h-5 w-5'
  if (s === 'critical') return <OctagonAlert className={cls} aria-hidden="true" />
  if (s === 'warning') return <AlertTriangle className={cls} aria-hidden="true" />
  return <Info className={cls} aria-hidden="true" />
}
