import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Announcement, type Catalog, type Me, type Service } from './api'

type FavoritesData = { services: Service[] }
type AnnouncementsData = { announcements: Announcement[] }

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api.me(signal) })
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: ({ signal }) => api.catalog(signal) })
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
