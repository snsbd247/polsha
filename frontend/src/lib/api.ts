import axios, { AxiosError } from 'axios'
import type { FormInstance } from 'antd'
import { lang, t as tx } from './i18n'

const TOKEN_KEY = 'polsha.token'

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t)
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* storage unavailable */
    }
  },
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  // X-Locale drives the backend's message language (Accept-Language is left to the browser).
  headers: { Accept: 'application/json', 'X-Locale': lang },
})

api.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// AuthProvider registers these so the interceptor can react without importing React state.
export const authEvents = {
  onUnauthorized: () => {},
  onPasswordChangeRequired: () => {},
}

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ code?: string }>) => {
    if (error.response?.status === 401) authEvents.onUnauthorized()
    if (error.response?.status === 403 && error.response.data?.code === 'password_change_required') {
      authEvents.onPasswordChangeRequired()
    }
    return Promise.reject(error)
  },
)

type ErrorBody = { message?: string; errors?: Record<string, string[]> }

export function errorMessage(error: unknown, fallback = tx('কিছু একটা সমস্যা হয়েছে।')): string {
  const e = error as AxiosError<ErrorBody>
  if (!e?.response) return tx('সার্ভারের সাথে সংযোগ করা যাচ্ছে না।')
  if (e.response.status === 403 && !e.response.data?.message) return tx('এই কাজের অনুমতি আপনার নেই।')
  return e.response.data?.message || fallback
}

/** Put Laravel 422 field errors onto the matching antd form fields. Returns true if any were applied. */
export function applyFormErrors(form: FormInstance, error: unknown): boolean {
  const errors = (error as AxiosError<ErrorBody>)?.response?.data?.errors
  if (!errors) return false
  form.setFields(
    Object.entries(errors).map(([name, msgs]) => ({
      name: name.includes('.') ? name.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : name,
      errors: msgs,
    })),
  )
  return true
}

export type Paginated<T> = {
  data: T[]
  current_page: number
  per_page: number
  total: number
}

/** Fetch a protected file (photo, backup) with the bearer token and return an object URL. */
export async function fetchBlobUrl(url: string): Promise<string> {
  const res = await api.get(url, { responseType: 'blob', baseURL: '' })
  return URL.createObjectURL(res.data)
}
