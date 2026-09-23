import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, authEvents, tokenStore } from '../lib/api'
import type { AuthUser } from '../lib/types'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string, remember: boolean) => Promise<AuthUser>
  logout: () => Promise<void>
  setUser: (u: AuthUser) => void
  can: (permission: string | string[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(() => !!tokenStore.get())
  const queryClient = useQueryClient()

  const clear = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    authEvents.onUnauthorized = clear
    authEvents.onPasswordChangeRequired = () =>
      setUser((u) => (u && !u.must_change_password ? { ...u, must_change_password: true } : u))
  }, [clear])

  useEffect(() => {
    if (!tokenStore.get()) return
    api
      .get<{ user: AuthUser }>('/me')
      .then((r) => setUser(r.data.user))
      .catch(() => clear())
      .finally(() => setLoading(false))
  }, [clear])

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const r = await api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password, remember })
    tokenStore.set(r.data.token)
    setUser(r.data.user)
    return r.data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      clear()
    }
  }, [clear])

  const can = useCallback(
    (permission: string | string[]) => {
      if (!user) return false
      if (user.is_super_admin) return true
      const list = Array.isArray(permission) ? permission : [permission]
      return list.some((p) => user.permissions.includes(p))
    },
    [user],
  )

  const value = useMemo(() => ({ user, loading, login, logout, setUser, can }), [user, loading, login, logout, can])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Renders children only when the user has the permission (any of, if a list). */
export function Can({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth()
  return can(perm) ? <>{children}</> : null
}
