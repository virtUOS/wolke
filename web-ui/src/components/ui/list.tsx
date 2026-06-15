import * as React from 'react'
import { cn } from '@/lib/utils'

// List / ListItem — the bordered, divided container the admin views use for their
// item lists (services, announcements, audit entries). These are item lists, not
// column-tabular data, so this is a styled <ul>/<li>, not a <table>; reach for a
// real Table primitive when genuinely tabular data (column headers) shows up.
export const List = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('divide-y divide-border rounded-md border border-border', className)} {...props} />
  ),
)
List.displayName = 'List'

// Row defaults to a horizontal layout; override gap/wrap/size via className
// (cn/twMerge resolves the conflicts).
export const ListItem = React.forwardRef<HTMLLIElement, React.LiHTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('flex items-center gap-3 px-3 py-2', className)} {...props} />
  ),
)
ListItem.displayName = 'ListItem'
