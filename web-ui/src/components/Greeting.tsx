import { Wrench } from 'lucide-react'

function getTimeGreeting(locale: string): string {
  const h = new Date().getHours()
  if (locale === 'en') {
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

function formatDate(): string {
  try {
    return new Date().toLocaleDateString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return ''
  }
}

interface GreetingProps {
  firstName: string
  locale: string
  isMobile: boolean
  favCount: number
  maintenanceCount: number
  onShowMaintenance: () => void
}

// Editorial greeting header: time-of-day salutation, the date, and at-a-glance
// counts (favorites, and a clickable "in maintenance" shortcut).
export function Greeting({ firstName, locale, isMobile, favCount, maintenanceCount, onShowMaintenance }: GreetingProps) {
  return (
    <header style={{ marginBottom: isMobile ? 18 : 28 }}>
      <div
        style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontWeight: 500,
          fontSize: isMobile ? 27 : 36,
          letterSpacing: '-0.015em',
          color: 'var(--text)',
          lineHeight: 1.05,
        }}
      >
        {getTimeGreeting(locale)}, {firstName}.
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}
        >
          {formatDate()}
        </span>
        {favCount > 0 && (
          <>
            <Dot />
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {favCount} {favCount === 1 ? 'Favorit' : 'Favoriten'}
            </span>
          </>
        )}
        {maintenanceCount > 0 && (
          <>
            <Dot />
            <button
              type="button"
              onClick={onShowMaintenance}
              className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer',
                background: 'none', border: 'none', padding: 0,
              }}
            >
              <Wrench className="h-[14px] w-[14px]" aria-hidden="true" />
              {maintenanceCount} {maintenanceCount === 1 ? 'Dienst' : 'Dienste'} in Wartung
            </button>
          </>
        )}
      </div>
    </header>
  )
}

// A small separator dot between greeting meta items.
function Dot() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--text-muted)', opacity: 0.5, flexShrink: 0 }}
    />
  )
}
