import { useRef } from 'react'
import { Wrench } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useAnchorTop } from '@/lib/useAnchorTop'
import { WATERMARK_ANCHOR_VAR } from './Watermark'

interface GreetingProps {
  firstName: string
  locale: string
  isMobile: boolean
  maintenanceCount: number
  /** Whether the greeting's trailing full stop is set in the brand primary
   *  (branding.greeting_accent, issue #220). False keeps the punctuation and
   *  drops the colour. */
  accent: boolean
  onShowMaintenance: () => void
}

// Editorial greeting header: time-of-day salutation, the date, and the
// "in maintenance" count as a clickable shortcut to that view.
//
// The favorites count used to sit here too; the tab row above the list carries
// it now (issue #170), so repeating it in the meta line was the same number
// twice, 24px apart.
export function Greeting({ firstName, locale, isMobile, maintenanceCount, accent, onShowMaintenance }: GreetingProps) {
  const s = t(locale)
  // The launcher watermark's vertical anchor (issue #195): the mark's top
  // aligns with this block's, and follows it when the announcement banner —
  // or anything else in the column — mounts or unmounts. The greeting
  // measures itself and publishes the value rather than the shell reaching
  // across the tree for an element it doesn't own.
  const ref = useRef<HTMLDivElement>(null)
  useAnchorTop(ref, WATERMARK_ANCHOR_VAR)
  return (
    // Plain <div>, not <header>: this sits inside <main>, and the salutation is
    // the page's <h1> — a sectioning <header> here would add landmark noise.
    <div ref={ref} style={{ marginBottom: isMobile ? 18 : 28 }}>
      <h1
        style={{
          margin: 0,
          // Issue #213: no serif on a web surface (UOS corporate design). The
          // display role is the body family — the greeting is told apart by
          // weight and size, not by a second face, so the distinction holds
          // whatever family a deployer substitutes (issue #214).
          fontFamily: 'var(--font-display)',
          // Medium, not light (issue #220): #213 left the weight open and
          // device testing on the running app answered it — 300 read flimsy on
          // a real screen. 500 is a real instance of the variable font
          // (wght 100–900), never a synthesised one. The tracking below comes
          // with it: weight and tracking are one treatment (design's board
          // option 10d), so neither number moves without the other.
          fontWeight: 500,
          fontSize: isMobile ? 27 : 36,
          letterSpacing: '-0.015em',
          color: 'var(--text)',
          lineHeight: 1.05,
        }}
      >
        {/* The accent wraps the punctuation only — never the salutation, never
            the name. It is the literal stop in this JSX that gets wrapped, not
            a match against the rendered line: both the salutation (which
            changes with the hour) and the name are variable, and a locale
            could legitimately end the greeting differently. Opting out drops
            the colour and keeps the stop. */}
        {s.greeting.salutation()}, {firstName}
        {accent ? <span style={{ color: 'var(--primary)' }}>.</span> : '.'}
      </h1>
      {/* Meta row (date + the maintenance shortcut) is desktop-only; the
          mobile layout is kept minimal — just the salutation. */}
      {!isMobile && (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <span
          className="text-xs"
          style={{
            fontWeight: 600, letterSpacing: '.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}
        >
          {s.greeting.today()}
        </span>
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
      )}
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
