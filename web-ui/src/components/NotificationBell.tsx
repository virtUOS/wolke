import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Bell, Info, OctagonAlert } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'
import { localized, type Severity } from '@/lib/api'
import { t, type Lang } from '@/lib/i18n'
import { useAnnouncements, useAnnouncementHistory } from '@/lib/admin-hooks'
import { useDismissAnnouncement } from '@/lib/hooks'
import { Alert, type alertVariants } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { focusFirst, trapTab } from '@/lib/focus'

// NotificationBell is the top-bar notification center (docs/01 §4.7): a bell that
// shows a dot while there are active, undismissed notices, and opens a panel
// listing the active ones (dismissible inline) above the user's history of past
// notices. History loads lazily — only when the panel first opens. The panel is a
// focus-trapped dialog (Escape / outside-click dismiss), mirroring the account
// menu so the chrome stays consistent.
export function NotificationBell({ locale }: { locale: Lang }) {
  const s = t(locale)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const active = useAnnouncements()
  const history = useAnnouncementHistory(open)
  const dismiss = useDismissAnnouncement()

  const activeList = active.data?.announcements ?? []
  const pastList = history.data?.announcements ?? []
  // The dot mirrors the active, undismissed count — no separate read-state.
  const unread = activeList.length

  useEffect(() => {
    if (!open) return
    // role="dialog" promises focus containment: move focus in on open, trap Tab,
    // and dismiss on Escape / outside-click (same contract as the account menu).
    focusFirst(panelRef.current)
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      trapTab(e, panelRef.current)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const fmtDate = (iso?: string) => {
    if (!iso) return ''
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <IconButton
        ref={triggerRef}
        aria-label={s.announce.bell(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--primary)] ring-2 ring-[var(--bg)]"
          />
        )}
      </IconButton>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={s.announce.center}
          tabIndex={-1}
          className="absolute right-0 z-20 w-[min(360px,calc(100vw-2rem))] rounded-md border border-border bg-bg p-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,.25)]"
          style={{ top: 'calc(100% + 8px)' }}
        >
          <h2 className="px-1 pb-2 text-sm font-semibold text-text">{s.announce.center}</h2>

          {activeList.length === 0 && pastList.length === 0 ? (
            <p className="px-1 py-3 text-sm text-text-muted">{s.announce.empty}</p>
          ) : (
            <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto">
              {activeList.length > 0 && (
                <ul className="space-y-2">
                  {activeList.map((a) => (
                    <li key={a.id}>
                      <Alert
                        variant={severityVariant(a.severity)}
                        icon={severityIcon(a.severity)}
                        title={localized(a.title, locale)}
                        dismissLabel={s.announce.dismiss}
                        onDismiss={
                          a.dismissible && a.severity !== 'critical' ? () => dismiss.mutate(a.id) : undefined
                        }
                      >
                        {localized(a.body, locale)}
                      </Alert>
                    </li>
                  ))}
                </ul>
              )}

              {pastList.length > 0 && (
                <section aria-label={s.announce.history}>
                  <h3 className="border-t border-border px-1 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                    {s.announce.history}
                  </h3>
                  <ul>
                    {pastList.map((a) => (
                      <li key={a.id} className="flex items-start gap-2 rounded px-1 py-2">
                        <span className={`mt-0.5 shrink-0 ${iconColorClass(a.severity)}`} aria-hidden="true">
                          {severityIcon(a.severity, 'h-4 w-4')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text">{localized(a.title, locale)}</p>
                          <p className="line-clamp-2 text-xs text-text-muted">{localized(a.body, locale)}</p>
                        </div>
                        <time className="shrink-0 text-xs text-text-muted" dateTime={a.created_at}>
                          {fmtDate(a.created_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Severities map onto the feedback tokens (docs/03 §2): critical reads as danger.
function severityVariant(s: Severity): VariantProps<typeof alertVariants>['variant'] {
  if (s === 'critical') return 'danger'
  if (s === 'warning') return 'warning'
  return 'info'
}

function severityIcon(s: Severity, cls = 'h-5 w-5') {
  if (s === 'critical') return <OctagonAlert className={cls} aria-hidden="true" />
  if (s === 'warning') return <AlertTriangle className={cls} aria-hidden="true" />
  return <Info className={cls} aria-hidden="true" />
}

function iconColorClass(s: Severity): string {
  if (s === 'critical') return 'text-danger'
  if (s === 'warning') return 'text-warning'
  return 'text-info'
}
