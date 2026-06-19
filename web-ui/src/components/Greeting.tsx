import { Wrench } from 'lucide-react'
import { t } from '@/lib/i18n'

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
  const s = t(locale)
  return (
    // Plain <div>, not <header>: this sits inside <main>, and the salutation is
    // the page's <h1> — a sectioning <header> here would add landmark noise.
    <div style={{ marginBottom: isMobile ? 18 : 28 }}>
      <h1
        style={{
          margin: 0,
          fontFamily: '"Newsreader Variable", Georgia, serif',
          fontWeight: 500,
          fontSize: isMobile ? 27 : 36,
          letterSpacing: '-0.015em',
          color: 'var(--text)',
          lineHeight: 1.05,
        }}
      >
        {s.greeting.salutation()}, {firstName}.
      </h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}
        >
          {s.greeting.today()}
        </span>
        {favCount > 0 && (
          <>
            <Dot />
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {s.greeting.favCount(favCount)}
            </span>
          </>
        )}
        {maintenanceCount > 0 && (
          <>
            <Dot />
            <button
              type="button"
              onClick={onShowMaintenance}
              className="rounded hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer',
                background: 'none', border: 'none', padding: 0,
              }}
            >
              <Wrench className="h-[14px] w-[14px]" aria-hidden="true" />
              {s.greeting.maintenanceCount(maintenanceCount)}
            </button>
          </>
        )}
      </div>
    </div>
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
