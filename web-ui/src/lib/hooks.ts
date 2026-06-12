import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Me } from './api'

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

// usePrefsMutation persists theme/view-mode and updates the cached `me`.
export function usePrefsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.updatePrefs,
    onSuccess: (me) => qc.setQueryData(['me'], me),
  })
}

export function useFavorites() {
  return useQuery({ queryKey: ['favorites'], queryFn: ({ signal }) => api.favorites(signal) })
}

export function useFrequent() {
  return useQuery({ queryKey: ['frequent'], queryFn: ({ signal }) => api.frequent(signal) })
}

// useFavoriteActions bundles the favorite mutations; each refreshes the lists.
export function useFavoriteActions() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['favorites'] })
  return {
    quickStar: useMutation({ mutationFn: (serviceID: string) => api.quickStar(serviceID), onSuccess }),
    addItem: useMutation({ mutationFn: (v: { listID: string; serviceID: string }) => api.addItem(v.listID, v.serviceID), onSuccess }),
    removeItem: useMutation({ mutationFn: (v: { listID: string; serviceID: string }) => api.removeItem(v.listID, v.serviceID), onSuccess }),
    createList: useMutation({ mutationFn: (name: string) => api.createList(name), onSuccess }),
    renameList: useMutation({ mutationFn: (v: { id: string; name: string }) => api.renameList(v.id, v.name), onSuccess }),
    reorderList: useMutation({ mutationFn: (v: { id: string; sort: number }) => api.reorderList(v.id, v.sort), onSuccess }),
    deleteList: useMutation({ mutationFn: (id: string) => api.deleteList(id), onSuccess }),
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
