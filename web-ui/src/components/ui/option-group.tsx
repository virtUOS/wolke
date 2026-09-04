import * as React from 'react'
import { cn } from '@/lib/utils'

// OptionGroup — a labelled row of pill buttons over a small set of
// (value, label) options: the app's switch-between-a-few-modes control. The
// account menu's theme and language switchers were the first two; the favorites
// order selector (issue #125) is the third, which is what moved it in here.
//
// Deliberately still styled with inline token variables rather than the cva
// pattern the rest of the set uses: this is a lift-and-shift of a control whose
// exact geometry is pinned by e2e (account-menu.spec.ts, issue #98 — every
// option's label on one line at every matrix width). Restyling it and moving it
// in one step would put that at risk for no gain.
export interface OptionGroupProps<T extends string> {
  /** Accessible name for the group (also the visible caption, where there is one). */
  label: string
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (next: T) => void
  className?: string
}

export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: OptionGroupProps<T>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%' }}
    >
      {options.map(([optionValue, optionLabel]) => {
        const active = value === optionValue
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
            style={{
              display: 'grid', placeItems: 'center',
              // nowrap is the hard guarantee of issue #98: an option's label
              // never breaks mid-word, whatever the language or the viewport.
              // The group may still wrap *between* options if a future label set
              // outgrows the panel — that degrades, it doesn't shatter a word.
              flex: '1 1 auto', whiteSpace: 'nowrap', padding: '5px 6px', fontSize: 12.5, lineHeight: 1.2,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: '1px solid var(--border)',
              background: active ? 'color-mix(in srgb, var(--accent) 38%, var(--surface))' : 'transparent',
              color: 'var(--text)', fontWeight: active ? 600 : 400,
            }}
            className={cn(
              'min-h-11 min-w-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
              'md:min-h-0 md:min-w-0',
            )}
          >
            {optionLabel}
          </button>
        )
      })}
    </div>
  )
}
