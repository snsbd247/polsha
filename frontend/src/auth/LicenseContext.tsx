import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api, authEvents } from '../lib/api'
import type { LicenseInfo } from '../lib/types'
import { useAuth } from './AuthContext'

type LicenseState = {
  info: LicenseInfo | null
  blocked: boolean
  status: LicenseInfo['state'] | null
  message: string
  expiresAt: string | null
  daysUntilExpiry: number | null
  refresh: () => Promise<LicenseInfo | null>
  setInfo: (l: LicenseInfo) => void
}

const LicenseContext = createContext<LicenseState | null>(null)

/** Look again on a page change when the last answer is older than this. */
const PAGE_RECHECK_MS = 5 * 60_000
/** …and in the background while the app stays open. */
const BACKGROUND_MS = 30 * 60_000

/**
 * The license as the backend judges it. Comes with sign-in (/me), then is
 * re-read on page changes, on returning to the tab and every 30 minutes; any
 * API answer with the lock code re-reads it at once — so a session that is
 * already open is stopped too, not only a new sign-in.
 */
export function LicenseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [info, setInfo] = useState<LicenseInfo | null>(null)
  const fetchedAt = useRef(0)

  // the copy that came with sign-in / /me
  useEffect(() => {
    if (!user) {
      setInfo(null)
      fetchedAt.current = 0
    } else if (user.license) {
      setInfo(user.license)
      fetchedAt.current = Date.now()
    }
  }, [user])

  const refresh = useCallback(async () => {
    if (!user) return null
    try {
      const r = await api.get<LicenseInfo>('/license/status')
      fetchedAt.current = Date.now()
      setInfo(r.data)
      return r.data
    } catch {
      return null
    }
  }, [user])

  useEffect(() => {
    authEvents.onWorkspaceLocked = () => {
      setInfo((l) => (l ? { ...l, blocked: true, state: 'blocked' } : l))
      refresh()
    }
  }, [refresh])

  // every page change, when the last look is old enough
  useEffect(() => {
    if (user && Date.now() - fetchedAt.current > PAGE_RECHECK_MS) refresh()
  }, [location.pathname, user, refresh])

  useEffect(() => {
    if (!user) return
    const onFocus = () => Date.now() - fetchedAt.current > 60_000 && refresh()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(refresh, BACKGROUND_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [user, refresh])

  // until the effect above has run, the copy that came with sign-in already counts
  const current = info ?? user?.license ?? null
  const value = useMemo<LicenseState>(
    () => ({
      info: current,
      blocked: !!current?.blocked,
      status: current?.state ?? null,
      message: current?.message ?? '',
      expiresAt: current?.expires_at ?? null,
      daysUntilExpiry: current?.days_until_expiry ?? null,
      refresh,
      setInfo,
    }),
    [current, refresh],
  )

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLicense() {
  const ctx = useContext(LicenseContext)
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider')
  return ctx
}
