// Catalog filtering for the dashboard. Two orthogonal concerns:
//   • search — global, matches name/description across ALL services; and
//   • filter — a single active facet (all | one category | maintenance).
// Search wins over filter (a query searches every service and ignores the
// active facet); these helpers are pure so the Dashboard wiring stays thin.

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

// matchesQuery: case-insensitive match on the service name or any localized
// description. An empty query matches everything.
export function matchesQuery(s: Service, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    s.name.toLowerCase().includes(q) ||
    Object.values(s.description).some((d) => d.toLowerCase().includes(q))
  )
}

// searchAll: global search over the given services, ignoring any filter.
export function searchAll(services: Service[], query: string): Service[] {
  if (!query.trim()) return services
  return services.filter((s) => matchesQuery(s, query))
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
