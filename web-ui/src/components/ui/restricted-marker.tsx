import * as React from 'react'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from './badge'

// RestrictedMarker — the one marker for "this is restricted to a visibility
// group" (docs/specs/service-visibility.md §2.2). It exists so the admin
// category list, the admin service list and the user's own filter pill say the
// same thing the same way, rather than each inventing a chip.
//
// `info`, not `warning`: a restricted category is a property, not a problem.
// Nothing is wrong with it, and the feedback tokens are load-bearing — warning
// is what "in Wartung" uses, and reusing it here would say the wrong thing at a
// glance (docs/03 §2).
//
// Two shapes, one glyph:
//   - with `label`  → the badge (a lock plus the group's name), for admin lists
//     where the marker is its own element in a row;
//   - without       → the bare lock, for places that already name the thing and
//     only need the qualifier: the category filter pill and the section
//     heading. Never a label change there — the pill has to stay the width the
//     touch target and the 324px strip were tuned for. It inherits the colour
//     it sits in and only softens it, so it stays subtle on a quiet pill and
//     stays legible on the brand-filled active one, where a fixed muted grey
//     would not.
//
// The accessible name is always the meaning, never the glyph: `srLabel` carries
// the whole sentence ("Nur für IT-Infrastruktur sichtbar"), and the visible
// label is hidden from the a11y tree so it is not announced twice. A bare lock
// with no accessible name would be worse than no marker at all. The sentence
// starts with a space so it never runs into whatever text precedes the marker —
// the pill's own label, the service's name — when a name is computed from the
// concatenated text.
export interface RestrictedMarkerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The group's display name; omit for the icon-only shape. */
  label?: string
  /** The full sentence a screen reader announces. Required — see above. */
  srLabel: string
}

export const RestrictedMarker = React.forwardRef<HTMLSpanElement, RestrictedMarkerProps>(
  ({ label, srLabel, className, ...props }, ref) => {
    const icon = <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
    if (label === undefined) {
      return (
        <span ref={ref} className={cn('inline-flex items-center opacity-70', className)} {...props}>
          {icon}
          <span className="sr-only">{' '}{srLabel}</span>
        </span>
      )
    }
    return (
      <Badge ref={ref} variant="info" className={cn('gap-1', className)} {...props}>
        {icon}
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{' '}{srLabel}</span>
      </Badge>
    )
  },
)
RestrictedMarker.displayName = 'RestrictedMarker'
