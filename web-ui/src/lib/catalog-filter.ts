// Catalog filtering for the dashboard's facet pills: a single active facet
// (all | one category | maintenance). Search is a separate concern handled
// server-side (see useSearch); these helpers are pure so the wiring stays thin.

import type { Service } from './api'

// Filter is single-select by construction: exactly one facet is ever active.
export type Filter =
  | { kind: 'all' }
  | { kind: 'category'; slug: string }
  | { kind: 'maintenance' }

export function filterEq(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'category' && b.kind === 'category') return a.slug === b.slug
  return true
}

// applyFilter: narrow services to the active facet (no search applied).
export function applyFilter(services: Service[], filter: Filter): Service[] {
  switch (filter.kind) {
    case 'category':
      return services.filter((s) => s.categories.includes(filter.slug))
    case 'maintenance':
      return services.filter((s) => s.tag === 'wartung')
    case 'all':
    default:
      return services
  }
}
