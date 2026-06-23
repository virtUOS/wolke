// Typed client for the JSON API. All server state flows through TanStack Query
// (see hooks.ts); these are the thin fetch primitives (CLAUDE.md).

export type Localized = Record<string, string>

export type ServiceTag = 'beta' | 'wartung'

// Which link a click followed, recorded for per-service metrics: the launch
// link (service or doc-only tile) vs the secondary documentation link.
export type ClickTarget = 'service' | 'documentation'

export interface Service {
  id: string
  name: string
  description: Localized
  service_url?: string
  doc_url?: string
  icon: string
  categories: string[]
  doc_only: boolean
  tag?: ServiceTag
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
  locale: 'auto' | 'de' | 'en'
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

// errorFromResponse builds an ApiError, preferring the server's problem+json
// `detail` (RFC-7807; see internal/server writeProblem) so validation messages
// reach the UI instead of a bare status code. Falls back to the status line when
// the body is missing or not JSON.
async function errorFromResponse(res: Response, fallback: string): Promise<ApiError> {
  try {
    const data = await res.json()
    const msg = data?.detail ?? data?.message ?? data?.error
    if (typeof msg === 'string' && msg.trim() !== '') {
      return new ApiError(res.status, msg)
    }
  } catch {
    // Empty or non-JSON body — fall through to the generic message.
  }
  return new ApiError(res.status, fallback)
}

// getJSON is the shared GET primitive: JSON accept header, ApiError on failure
// (with the server's problem+json detail). Exported so other lib modules (e.g.
// branding) don't re-implement fetch + error handling.
export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw await errorFromResponse(res, `GET ${url} → ${res.status}`)
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
    throw await errorFromResponse(res, `${method} ${url} → ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const api = {
  me: (signal?: AbortSignal) => getJSON<Me>('/api/me', signal),
  catalog: (signal?: AbortSignal) => getJSON<Catalog>('/api/catalog', signal),
  defaults: (signal?: AbortSignal) => getJSON<DefaultsView>('/api/catalog/defaults', signal),
  search: (q: string, signal?: AbortSignal) =>
    getJSON<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  updatePrefs: (patch: Partial<Pick<Me, 'theme' | 'view_mode' | 'locale' | 'favorites_order' | 'favorites_separate_tab'>>) =>
    send<Me>('PATCH', '/api/me/prefs', patch),

  // favorites — a flat per-user set (no lists; docs/01 §4.4)
  favorites: (signal?: AbortSignal) => getJSON<{ services: Service[] }>('/api/favorites', signal),
  addFavorite: (serviceID: string) => send<void>('POST', '/api/favorites/items', { service_id: serviceID }),
  removeFavorite: (serviceID: string) => send<void>('DELETE', '/api/favorites/items', { service_id: serviceID }),

  // usage
  frequent: (signal?: AbortSignal) => getJSON<{ services: Service[] }>('/api/usage/frequent', signal),
  recordClick: (serviceID: string, target: ClickTarget = 'service') => {
    // Fire-and-forget; a failed event must never disrupt the launch.
    void send('POST', '/api/events/click', { service_id: serviceID, target }).catch(() => {})
  },

  // announcements (user-facing)
  announcements: (signal?: AbortSignal) => getJSON<{ announcements: Announcement[] }>('/api/announcements', signal),
  dismissAnnouncement: (id: string) => send<void>('POST', `/api/announcements/${id}/dismiss`),

  // admin
  adminServices: (signal?: AbortSignal) => getJSON<{ services: AdminService[] }>('/api/admin/services', signal),
  createService: (d: ServiceDraft) => send<AdminService>('POST', '/api/admin/services', d),
  updateService: (id: string, d: ServiceDraft) => send<AdminService>('PATCH', `/api/admin/services/${id}`, d),
  deleteService: (id: string) => send<void>('DELETE', `/api/admin/services/${id}`),
  roleDefaults: (role: string, signal?: AbortSignal) =>
    getJSON<{ service_ids: string[] }>(`/api/admin/role-defaults/${role}`, signal),
  setRoleDefaults: (role: string, serviceIDs: string[]) =>
    send<void>('PUT', `/api/admin/role-defaults/${role}`, { service_ids: serviceIDs }),
  createCategory: (slug: string, label: Localized, sort: number) =>
    send<{ slug: string }>('POST', '/api/admin/categories', { slug, label, sort }),
  adminAnnouncements: (signal?: AbortSignal) =>
    getJSON<{ announcements: Announcement[] }>('/api/admin/announcements', signal),
  createAnnouncement: (a: AnnouncementInput) => send<Announcement>('POST', '/api/admin/announcements', a),
  updateAnnouncement: (id: string, a: AnnouncementInput) =>
    send<Announcement>('PATCH', `/api/admin/announcements/${id}`, a),
  deleteAnnouncement: (id: string) => send<void>('DELETE', `/api/admin/announcements/${id}`),
  audit: (signal?: AbortSignal) => getJSON<{ entries: AuditEntry[] }>('/api/admin/audit', signal),
}

export interface AdminService {
  id: string
  name: string
  description: Localized
  service_url?: string
  doc_url?: string
  icon: string
  is_active: boolean
  categories: string[]
  tag?: ServiceTag
}

export interface ServiceDraft {
  name: string
  description: Localized
  service_url: string
  doc_url: string
  icon: string
  categories: string[]
  // '' means "no status label"; the backend treats empty as unset.
  tag: ServiceTag | ''
}

export type Severity = 'info' | 'warning' | 'critical'
export type Audience = 'all' | 'student' | 'teacher' | 'staff'

export interface Announcement {
  id: string
  title: Localized
  body: Localized
  severity: Severity
  audience: Audience
  starts_at?: string
  ends_at?: string
  dismissible: boolean
}

export interface AnnouncementInput {
  title: Localized
  body: Localized
  severity: Severity
  audience: Audience
  starts_at?: string | null
  ends_at?: string | null
  dismissible: boolean
}

export interface AuditEntry {
  id: number
  actor_id: string
  actor_name?: string // resolved display name; absent for null/MCP actors
  actor_kind: string
  action: string
  target_id?: string
  diff?: unknown
  created_at: string
}

// localized picks the active-locale string with sensible fallbacks, never
// breaking on a missing translation.
export function localized(m: Localized | undefined, locale: string): string {
  if (!m) return ''
  return m[locale] ?? m.de ?? m.en ?? Object.values(m)[0] ?? ''
}

// localizedInput builds a Localized value from a de/en form pair: de (required)
// plus en only when filled (an empty field clears the translation rather than
// persisting ""). Any other locales already present on `existing` are preserved.
export function localizedInput(existing: Localized | undefined, de: string, en: string): Localized {
  const m: Localized = { ...existing, de: de.trim() }
  const trimmed = en.trim()
  if (trimmed) m.en = trimmed
  else delete m.en
  return m
}
