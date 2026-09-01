import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Announcement, type Catalog, type Me, type Service } from './api'

type FavoritesData = { services: Service[] }
type AnnouncementsData = { announcements: Announcement[] }

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api.me(signal) })
}

// useRoles is the deployment's configured role set, in precedence order. The
// admin screens render from it rather than from a hardcoded list, so a two-role
// deployment shows two roles (docs/specs/configurable-roles.md §2.4).
export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: ({ signal }) => api.roles(signal) })
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: ({ signal }) => api.catalog(signal) })
}

// useDebouncedValue delays propagating rapid changes (e.g. each keystroke) so
// search doesn't fire a request per character.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/** How long the result-count live region keeps its message before going quiet. */
export const ANNOUNCEMENT_MS = 5000

/**
 * useResultAnnouncement returns the text for the dashboard's polite live region:
 * the result count, but only for a short window after it *changes*, and never on
 * first render.
 *
 * Empty at rest is the whole point (issue #35) — a permanently populated sr-only
 * node is a stop in the screen reader's reading order with nothing on the screen
 * to match it, which on a phone is an empty box between the search field and the
 * first tile.
 *
 * @param count the settled result count, or null while it is still arriving — an
 *   in-flight query's count is stale, and the first settled value is the
 *   baseline (the page just loaded), not news.
 * @param message the announcement for the current count.
 * @param settleKey identifies *what* was searched/filtered to produce this
 *   count (e.g. the query text) — distinct from a re-render that leaves the
 *   same search settled, such as a locale switch (new message, same count,
 *   same key). A settle with a new key is news even when the count happens
 *   to match the previous one: two different searches that both turn up 3
 *   results are still two separate results a screen-reader user typed for.
 */
export function useResultAnnouncement(count: number | null, message: string, settleKey: string): string {
  const [announcement, setAnnouncement] = useState('')
  const previous = useRef<{ key: string; count: number } | null>(null)

  useEffect(() => {
    if (count === null) return
    const last = previous.current
    previous.current = { key: settleKey, count }
    // Nothing to announce on the first settled value, or when neither the
    // search nor its count changed (a locale switch re-runs this with a new
    // message, not new news).
    if (last === null || (last.key === settleKey && last.count === count)) return
    setAnnouncement(message)
  }, [count, message, settleKey])

  // The hide timer belongs to the *announcement*, not to the count. Owned by the
  // effect above it was cleared whenever the count changed again — including
  // count → null when the next keystroke put a query in flight — and the early
  // return then set no replacement, leaving the region populated for good.
  useEffect(() => {
    if (announcement === '') return
    const timer = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS)
    return () => clearTimeout(timer)
  }, [announcement])

  return announcement
}

// useSearch runs the server-side search for a (trimmed) query. It's the single
// search path — fuzzy/keyword matching and ranking live in the backend (docs/01
// §4.6). Previous results stay visible while the next query loads, so typing
// doesn't flash an empty list.
export function useSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q !== '',
    placeholderData: (prev) => prev,
  })
}

export function useDefaults() {
  return useQuery({ queryKey: ['defaults'], queryFn: ({ signal }) => api.defaults(signal) })
}

// usePrefsMutation persists theme/view-mode. It patches the cached `me`
// optimistically so a theme toggle flips immediately, then reconciles with the
// server response; on error it rolls back.
export function usePrefsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.updatePrefs,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['me'] })
      const prev = qc.getQueryData<Me>(['me'])
      if (prev) qc.setQueryData<Me>(['me'], { ...prev, ...patch })
      return { prev }
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev)
    },
    onSuccess: (me) => qc.setQueryData(['me'], me),
  })
}

export function useFavorites() {
  return useQuery({ queryKey: ['favorites'], queryFn: ({ signal }) => api.favorites(signal) })
}

// useDismissAnnouncement persists a dismissal so the banner stays gone across
// reloads. It removes the announcement from the cache optimistically, rolls back
// on error, and reconciles with the server (which now filters it out) on settle.
export function useDismissAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.dismissAnnouncement(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['announcements'] })
      const prev = qc.getQueryData<AnnouncementsData>(['announcements'])
      if (prev) {
        qc.setQueryData<AnnouncementsData>(['announcements'], {
          announcements: prev.announcements.filter((a) => a.id !== id),
        })
      }
      return { prev }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['announcements'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  })
}

// useFavoriteActions bundles add/remove with optimistic updates so the star
// toggles instantly: the favorites cache is patched on mutate (add pulls the
// service from the catalog cache), rolled back on error, and reconciled with the
// server on settle.
export function useFavoriteActions() {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: ['favorites'] })
  const onError = (_e: unknown, _id: string, ctx: { prev?: FavoritesData } | undefined) => {
    if (ctx?.prev) qc.setQueryData(['favorites'], ctx.prev)
  }
  return {
    add: useMutation({
      mutationFn: (serviceID: string) => api.addFavorite(serviceID),
      onMutate: async (serviceID: string) => {
        await qc.cancelQueries({ queryKey: ['favorites'] })
        const prev = qc.getQueryData<FavoritesData>(['favorites'])
        const svc = qc.getQueryData<Catalog>(['catalog'])?.services.find((s) => s.id === serviceID)
        if (prev && svc && !prev.services.some((s) => s.id === serviceID)) {
          qc.setQueryData<FavoritesData>(['favorites'], { services: [...prev.services, svc] })
        }
        return { prev }
      },
      onError,
      onSettled,
    }),
    remove: useMutation({
      mutationFn: (serviceID: string) => api.removeFavorite(serviceID),
      onMutate: async (serviceID: string) => {
        await qc.cancelQueries({ queryKey: ['favorites'] })
        const prev = qc.getQueryData<FavoritesData>(['favorites'])
        if (prev) {
          qc.setQueryData<FavoritesData>(['favorites'], { services: prev.services.filter((s) => s.id !== serviceID) })
        }
        return { prev }
      },
      onError,
      onSettled,
    }),
  }
}

// usePrefersDark tracks the OS dark-mode preference and re-renders on change, so
// values derived from it (e.g. the effective `isDark` when theme === 'system')
// stay live instead of being frozen at the first render.
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return dark
}

// useApplyTheme applies the effective theme as the `.dark` class on <html>,
// resolving 'system' against the OS preference and reacting to OS changes.
export function useApplyTheme(theme: Me['theme'] | undefined) {
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme !== 'light' && mql.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system' || theme === undefined) {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
  }, [theme])
}
