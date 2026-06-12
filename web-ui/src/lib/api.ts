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
  favorites_order: 'usage' | 'alpha'
  favorites_separate_tab: boolean
}

export interface DefaultsView {
  role: string
  services: Service[]
}

export interface SearchResults {
  query: string
  services: Service[]
}


// ApiError carries the HTTP status so callers can react (e.g. redirect to login
// on 401) rather than treating every failure the same.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new ApiError(res.status, `GET ${url} → ${res.status}`)
  }
  return (await res.json()) as T
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    throw new ApiError(res.status, `${method} ${url} → ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const api = {
  me: (signal?: AbortSignal) => getJSON<Me>('/api/me', signal),
  catalog: (signal?: AbortSignal) => getJSON<Catalog>('/api/catalog', signal),
  defaults: (signal?: AbortSignal) => getJSON<DefaultsView>('/api/catalog/defaults', signal),
  search: (q: string, signal?: AbortSignal) =>
    getJSON<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  updatePrefs: (patch: Partial<Pick<Me, 'theme' | 'view_mode' | 'favorites_order' | 'favorites_separate_tab'>>) =>
    send<Me>('PATCH', '/api/me/prefs', patch),

  // favorites — a flat per-user set (no lists; docs/01 §4.4)
  favorites: (signal?: AbortSignal) => getJSON<{ services: Service[] }>('/api/favorites', signal),
  addFavorite: (serviceID: string) => send<void>('POST', '/api/favorites/items', { service_id: serviceID }),
  removeFavorite: (serviceID: string) => send<void>('DELETE', '/api/favorites/items', { service_id: serviceID }),

  // usage
  frequent: (signal?: AbortSignal) => getJSON<{ services: Service[] }>('/api/usage/frequent', signal),
  recordClick: (serviceID: string) => {
    // Fire-and-forget; a failed event must never disrupt the launch.
    void send('POST', '/api/events/click', { service_id: serviceID }).catch(() => {})
  },
}

// localized picks the active-locale string with sensible fallbacks, never
// breaking on a missing translation.
export function localized(m: Localized | undefined, locale: string): string {
  if (!m) return ''
  return m[locale] ?? m.de ?? m.en ?? Object.values(m)[0] ?? ''
}
