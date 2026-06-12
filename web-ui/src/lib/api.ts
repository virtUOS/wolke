// Typed client for the JSON API. All server state flows through TanStack Query
// (see hooks.ts); these are the thin fetch primitives (CLAUDE.md).

export type Localized = Record<string, string>

export interface Service {
  id: string
  name: string
  description: Localized
  service_url?: string
  doc_url?: string
  icon: string
  categories: string[]
  doc_only: boolean
}

export interface Category {
  slug: string
  label: Localized
  sort: number
}

export interface Catalog {
  services: Service[]
  categories: Category[]
}

export interface Me {
  id: string
  display_name: string
  email?: string
  primary_role: 'student' | 'teacher' | 'staff'
  is_admin: boolean
  view_mode: 'list' | 'table' | 'auto'
  theme: 'light' | 'dark' | 'system'
}

export interface DefaultsView {
  role: string
  services: Service[]
}

export interface SearchResults {
  query: string
  services: Service[]
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}`)
  }
  return (await res.json()) as T
}

export const api = {
  me: (signal?: AbortSignal) => getJSON<Me>('/api/me', signal),
  catalog: (signal?: AbortSignal) => getJSON<Catalog>('/api/catalog', signal),
  defaults: (signal?: AbortSignal) => getJSON<DefaultsView>('/api/catalog/defaults', signal),
  search: (q: string, signal?: AbortSignal) =>
    getJSON<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  updatePrefs: async (patch: Partial<Pick<Me, 'theme' | 'view_mode'>>): Promise<Me> => {
    const res = await fetch('/api/me/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      throw new Error(`PATCH /api/me/prefs → ${res.status}`)
    }
    return (await res.json()) as Me
  },
}

// localized picks the active-locale string with sensible fallbacks, never
// breaking on a missing translation.
export function localized(m: Localized | undefined, locale: string): string {
  if (!m) return ''
  return m[locale] ?? m.de ?? m.en ?? Object.values(m)[0] ?? ''
}
