import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Role } from './types'

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<Role[]>('/roles')).data,
    enabled,
  })
}

/** Role labels only — readable by every signed-in user. */
export function useRoleLabels() {
  return useQuery({
    queryKey: ['roles', 'options'],
    queryFn: async () => (await api.get<{ name: string; label: string | null }[]>('/roles/options')).data,
    staleTime: 5 * 60_000,
  })
}

export const roleOptions = (roles: Role[] = []) => roles.map((r) => ({ value: r.name, label: r.label ?? r.name }))
