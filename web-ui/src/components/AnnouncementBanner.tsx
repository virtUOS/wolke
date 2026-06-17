import { useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { localized, type Announcement, type Severity } from '@/lib/api'
import { Alert } from '@/components/ui/alert'
import type { alertVariants } from '@/components/ui/alert'
import type { VariantProps } from 'class-variance-authority'

// Role-scoped announcement banners (docs/01 §4.7, docs/03 §8): severity-colored,
// stacked, dismissible except critical, announced via an aria-live region. Each
// banner is an Alert primitive; this component owns the live region and which
// announcements are visible.
export function AnnouncementBanner({ announcements, locale }: { announcements: Announcement[]; locale: string }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const visible = announcements.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div role="region" aria-label="Ankündigungen" aria-live="polite" className="space-y-2">
      {visible.map((a) => (
        <Alert
          key={a.id}
          variant={severityVariant(a.severity)}
          icon={severityIcon(a.severity)}
          title={localized(a.title, locale)}
          dismissLabel="Ankündigung schließen"
          onDismiss={
            a.dismissible && a.severity !== 'critical'
              ? () => setDismissed((d) => new Set(d).add(a.id))
              : undefined
          }
        >
          {localized(a.body, locale)}
        </Alert>
      ))}
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
