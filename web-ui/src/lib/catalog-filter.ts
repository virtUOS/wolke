// Catalog filtering for the dashboard's facet pills: a single active facet
// (all | one category | maintenance | beta). Search is a separate concern
// handled server-side (see useSearch); these helpers are pure so the wiring
// stays thin.

import type { Service } from './api'

// Filter is single-select by construction: exactly one facet is ever active.
export type Filter =
  | { kind: 'all' }
  | { kind: 'category'; slug: string }
  | { kind: 'maintenance' }
  // Beta is the exact parallel of maintenance, one tag along. Its pill only
  // renders while show_beta is on — with the pref off the catalog carries no
  // beta service at all (docs/specs/service-visibility.md §2.1).
  | { kind: 'beta' }

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
    case 'beta':
      return services.filter((s) => s.tag === 'beta')
    case 'all':
    default:
      return services
  }
}
