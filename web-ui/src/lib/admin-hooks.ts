import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AnnouncementInput, type Localized, type ServiceDraft } from './api'

export function useAdminServices() {
  return useQuery({ queryKey: ['admin', 'services'], queryFn: ({ signal }) => api.adminServices(signal) })
}

export function useAudit() {
  return useQuery({ queryKey: ['admin', 'audit'], queryFn: ({ signal }) => api.audit(signal) })
}

export function useSearchInsights() {
  return useQuery({ queryKey: ['admin', 'search-insights'], queryFn: ({ signal }) => api.searchInsights(signal) })
}

export function useAdminAnnouncements() {
  return useQuery({ queryKey: ['admin', 'announcements'], queryFn: ({ signal }) => api.adminAnnouncements(signal) })
}

// useAnnouncements is the user-facing active list (for the dashboard banner).
export function useAnnouncements() {
  return useQuery({ queryKey: ['announcements'], queryFn: ({ signal }) => api.announcements(signal) })
}

// useAdminActions bundles the admin write mutations; each refreshes the views it
// affects (admin lists + the public catalog/announcements + audit).
export function useAdminActions() {
  const qc = useQueryClient()
  const afterCatalogWrite = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'services'] })
    qc.invalidateQueries({ queryKey: ['admin', 'audit'] })
    qc.invalidateQueries({ queryKey: ['catalog'] })
    qc.invalidateQueries({ queryKey: ['defaults'] })
    qc.invalidateQueries({ queryKey: ['favorites'] })
  }
  const afterAnnouncementWrite = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    qc.invalidateQueries({ queryKey: ['admin', 'audit'] })
    qc.invalidateQueries({ queryKey: ['announcements'] })
  }
  return {
    createService: useMutation({ mutationFn: (d: ServiceDraft) => api.createService(d), onSuccess: afterCatalogWrite }),
    updateService: useMutation({
      mutationFn: (v: { id: string; draft: ServiceDraft }) => api.updateService(v.id, v.draft),
      onSuccess: afterCatalogWrite,
    }),
    deleteService: useMutation({ mutationFn: (id: string) => api.deleteService(id), onSuccess: afterCatalogWrite }),
    setRoleDefaults: useMutation({
      mutationFn: (v: { role: string; serviceIDs: string[] }) => api.setRoleDefaults(v.role, v.serviceIDs),
      onSuccess: afterCatalogWrite,
    }),
    createCategory: useMutation({
      mutationFn: (v: { slug: string; label: Localized; sort: number }) =>
        api.createCategory(v.slug, v.label, v.sort),
      onSuccess: afterCatalogWrite,
    }),
    createAnnouncement: useMutation({
      mutationFn: (a: AnnouncementInput) => api.createAnnouncement(a),
      onSuccess: afterAnnouncementWrite,
    }),
    updateAnnouncement: useMutation({
      mutationFn: (v: { id: string; input: AnnouncementInput }) => api.updateAnnouncement(v.id, v.input),
      onSuccess: afterAnnouncementWrite,
    }),
    deleteAnnouncement: useMutation({
      mutationFn: (id: string) => api.deleteAnnouncement(id),
      onSuccess: afterAnnouncementWrite,
    }),
  }
}
