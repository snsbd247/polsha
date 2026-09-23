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

export const roleOptions = (roles: Role[] = []) => roles.map((r) => ({ value: r.name, label: r.label ?? r.name }))
