import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Card — the rounded, bordered surface the app's tiles, admin panels, menus, and
// form groups all sit on (docs/03 §5). It is purely presentational: a container,
// not a control. Any interactivity lives in the children (e.g. the Tile's launch
// link); `interactive` only adds the visual hover-lift, never a role or handler.
const cardVariants = cva('rounded-lg border border-border bg-bg', {
  variants: {
    padding: { none: '', sm: 'p-3', md: 'p-4' },
    elevation: { none: '', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg' },
    // A hover elevation cue for cards that act as a single launch target. The
    // motion respects prefers-reduced-motion via the global rule (docs/03 §8).
    interactive: { true: 'transition-shadow hover:shadow-md', false: '' },
  },
  defaultVariants: { padding: 'none', elevation: 'none', interactive: false },
})

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding, elevation, interactive, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ padding, elevation, interactive }), className)} {...props} />
  ),
)
Card.displayName = 'Card'

export { cardVariants }
