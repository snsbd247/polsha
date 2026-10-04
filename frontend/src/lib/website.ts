import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { lang } from './i18n'

/** A text the society writes in Bangla, with an optional English version. */
export type Bi = { bn: string; en: string }

export type SiteNotice = { date: string; title: Bi; tag: Bi }
export type SitePerson = { name: Bi; role: Bi; photo: string | null }
export type SitePhoto = { photo: string; caption: Bi }

export type SiteContent = {
  enabled: boolean
  show_stats: boolean
  tagline: Bi
  intro: Bi
  founded_year: string
  work_area: Bi
  about_photo: string | null
  notices: SiteNotice[]
  committee: SitePerson[]
  gallery: SitePhoto[]
  phone: string
  email: string
  address: Bi
  hours: Bi
  map_url: string
}

export type SiteStat = { key: 'members' | 'farmers' | 'irrigated_acres' | 'years'; value: number }

/** What the public landing page receives: the content plus contact fallbacks and live numbers. */
export type PublicSite = SiteContent & { registration_no: string; stats: SiteStat[] }

export const emptyBi = (): Bi => ({ bn: '', en: '' })

/** English when the visitor reads English and the society wrote it; Bangla otherwise. */
export const pick = (b?: Bi | null) => (lang === 'en' && b?.en?.trim()) || b?.bn || ''

/** Stored photos are "website/<name>.jpg"; the public API serves them by name. */
export const sitePhotoUrl = (path: string) => `${import.meta.env.VITE_API_URL}/public/website/images/${path.replace(/^website\//, '')}`

export function usePublicSite() {
  return useQuery({
    queryKey: ['public-website'],
    queryFn: async () => (await api.get<PublicSite>('/public/website')).data,
    staleTime: 5 * 60_000,
  })
}
