import { useState } from 'react'
import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react'
import { localized, type Announcement, type Severity } from '@/lib/api'

// Role-scoped announcement banners (docs/01 §4.7, docs/03 §8): severity-colored,
// stacked, dismissible except critical, announced via an aria-live region.
export function AnnouncementBanner({ announcements, locale }: { announcements: Announcement[]; locale: string }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const visible = announcements.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div role="region" aria-label="Ankündigungen" aria-live="polite" className="mx-auto max-w-6xl space-y-2 px-4 pt-4">
      {visible.map((a) => (
        <div key={a.id} className={'flex items-start gap-3 rounded-md border px-4 py-3 text-sm ' + tone(a.severity)}>
          <span className="mt-0.5 shrink-0">{icon(a.severity)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{localized(a.title, locale)}</p>
            <p className="text-text/80">{localized(a.body, locale)}</p>
          </div>
          {a.dismissible && a.severity !== 'critical' && (
            <button
              type="button"
              aria-label="Ankündigung schließen"
              onClick={() => setDismissed((d) => new Set(d).add(a.id))}
              className="shrink-0 rounded-md p-1 text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function tone(s: Severity): string {
  switch (s) {
    case 'critical':
      return 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--bg))]'
    case 'warning':
      return 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_15%,var(--bg))]'
    default:
      return 'border-surface bg-surface'
  }
}

function icon(s: Severity) {
  const cls = 'h-5 w-5'
  if (s === 'critical') return <OctagonAlert className={cls + ' text-primary'} aria-hidden="true" />
  if (s === 'warning') return <AlertTriangle className={cls} aria-hidden="true" />
  return <Info className={cls + ' text-text-muted'} aria-hidden="true" />
}
