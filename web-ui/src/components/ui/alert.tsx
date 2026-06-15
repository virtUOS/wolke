import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

// Alert — a severity-coloured message box (announcements, inline notices). The
// variant tints the border, a soft background, and the leading icon from one
// feedback token (docs/03 §2), staying legible in dark mode via color-mix with
// the canvas. Presentational: announcement live-region semantics stay with the
// caller (AnnouncementBanner wraps these in an aria-live region).
const alertVariants = cva('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', {
  variants: {
    variant: {
      info: 'border-info bg-[color-mix(in_srgb,var(--info)_10%,var(--bg))]',
      warning: 'border-warning bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg))]',
      success: 'border-success bg-[color-mix(in_srgb,var(--success)_10%,var(--bg))]',
      danger: 'border-danger bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg))]',
    },
  },
  defaultVariants: { variant: 'info' },
})

const iconColor: Record<NonNullable<VariantProps<typeof alertVariants>['variant']>, string> = {
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
}

// Omit the native `title` (a string tooltip attr) so our richer ReactNode title wins.
interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  /** Leading icon (a lucide icon); tinted to match the variant. */
  icon?: React.ReactNode
  title?: React.ReactNode
  /** When set, a dismiss control is shown; needs an accessible label. */
  onDismiss?: () => void
  dismissLabel?: string
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, icon, title, onDismiss, dismissLabel = 'Schließen', children, ...props }, ref) => (
    <div ref={ref} className={cn(alertVariants({ variant }), className)} {...props}>
      {icon && <span className={cn('mt-0.5 shrink-0', iconColor[variant ?? 'info'])}>{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-text">{title}</p>}
        {children && <div className="text-text/80">{children}</div>}
      </div>
      {onDismiss && (
        <IconButton variant="plain" size="sm" aria-label={dismissLabel} onClick={onDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  ),
)
Alert.displayName = 'Alert'

export { alertVariants }
