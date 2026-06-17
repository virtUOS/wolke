import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Catalog, type Me, type Service } from './api'

type FavoritesData = { services: Service[] }

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api.me(signal) })
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: ({ signal }) => api.catalog(signal) })
}

export function useDefaults() {
  return useQuery({ queryKey: ['defaults'], queryFn: ({ signal }) => api.defaults(signal) })
}

// useSearch is enabled only for a non-empty query; previous results stay visible
// while the next query loads (no flicker).
export function useSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  })
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
