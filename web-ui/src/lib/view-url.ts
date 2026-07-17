// The dashboard's view state (tab, filter, admin) serialized to/from the URL,
// so view changes can be real history entries (Back/Forward walk through
// views — issue #29) and views are deep-linkable. Pure functions; the history
// wiring lives in view-history.ts.
//
// Scheme (query params on "/"; the default view serializes to plain "/"):
//   /?tab=dienste        Dienste tab, no filter
//   /?cat=<slug>         category filter (implies tab=dienste, tab omitted)
//   /?filter=wartung     maintenance filter (implies tab=dienste)
//   /?admin=1            admin view; combines with the above
// Invariant: filter ≠ all ⟹ tab = dienste (filter params win over a
// contradictory tab). Parsing is lenient — unknown values fall back to the
// default; slugs are accepted as-is (the catalog loads async; Dashboard
// degrades unknown slugs once it arrives).

import { filterEq, type Filter } from './catalog-filter'

export type Tab = 'favoriten' | 'dienste'

export interface View {
  tab: Tab
  filter: Filter
  admin: boolean
}

export const DEFAULT_VIEW: View = { tab: 'favoriten', filter: { kind: 'all' }, admin: false }

export function viewEq(a: View, b: View): boolean {
  return a.tab === b.tab && a.admin === b.admin && filterEq(a.filter, b.filter)
}

export function viewToURL(view: View): string {
  const q = new URLSearchParams()
  if (view.filter.kind === 'category') {
    q.set('cat', view.filter.slug)
  } else if (view.filter.kind === 'maintenance') {
    q.set('filter', 'wartung')
  } else if (view.tab === 'dienste') {
    q.set('tab', 'dienste')
  }
  if (view.admin) q.set('admin', '1')
  const s = q.toString()
  return s === '' ? '/' : `/?${s}`
}

export function parseViewURL(search: string): View {
  const q = new URLSearchParams(search)
  const cat = q.get('cat')
  let filter: Filter = { kind: 'all' }
  if (cat) {
    filter = { kind: 'category', slug: cat }
  } else if (q.get('filter') === 'wartung') {
    filter = { kind: 'maintenance' }
  }
  const tab: Tab = filter.kind !== 'all' || q.get('tab') === 'dienste' ? 'dienste' : 'favoriten'
  return { tab, filter, admin: q.get('admin') === '1' }
}
