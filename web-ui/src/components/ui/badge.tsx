import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Badge — a small status pill (announcement severity, a service's inactive state,
// …). Semantic variants map to the feedback tokens (docs/03 §2). Colours are a
// soft tint of the token mixed with the canvas, which stays legible in both
// light and dark (a solid fill of the lightened dark-mode token would not). The
// label text always carries the meaning, so colour is never the sole signal.
const badgeVariants = cva('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      neutral: 'bg-surface-2 text-text-muted',
      info: 'bg-[color-mix(in_srgb,var(--info)_12%,var(--bg))] text-info',
      warning: 'bg-[color-mix(in_srgb,var(--warning)_12%,var(--bg))] text-warning',
      success: 'bg-[color-mix(in_srgb,var(--success)_12%,var(--bg))] text-success',
      danger: 'bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg))] text-danger',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'

export { badgeVariants }
