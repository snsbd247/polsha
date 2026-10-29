import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { lang } from './i18n'

/** A text the society writes in Bangla, with an optional English version. */
export type Bi = { bn: string; en: string }

/** id: the notice's page address (/notices/:id); attachment: a photo or PDF in the site's folder. */
export type SiteNotice = { id?: string; date: string; title: Bi; tag: Bi; body?: Bi; attachment?: string | null; attachment_name?: string }
export type SitePresident = { name: Bi; role: Bi; photo: string | null; message: Bi }
export type SiteWaterType = { code: string; name: Bi; monthly_fee: number; connection_fee: number }
export type SitePerson = { name: Bi; role: Bi; photo: string | null }
export type SitePhoto = { photo: string; caption: Bi }
export type SiteFaq = { q: Bi; a: Bi }

export type SiteContent = {
  enabled: boolean
  show_stats: boolean
  brand_title: Bi
  brand_subtitle: Bi
  brand_tagline: Bi
  hero_kicker: Bi
  hero_title: Bi
  hero_photos: string[]
  tagline: Bi
  about_title: Bi
  intro: Bi
  vision: Bi
  mission: Bi
  values: Bi
  faqs: SiteFaq[]
  facebook: string
  youtube: string
  instagram: string
  founded_year: string
  work_area: Bi
  about_photo: string | null
  notices: SiteNotice[]
  president: SitePresident
  committee: SitePerson[]
  gallery: SitePhoto[]
  phone: string
  email: string
  address: Bi
  hours: Bi
  map_url: string
}

export type SiteStat = { key: 'members' | 'farmers' | 'irrigated_acres' | 'water_connections' | 'years'; value: number }

/** What the public landing page receives: the content plus contact fallbacks and live numbers. */
export type PublicSite = SiteContent & { registration_no: string; stats: SiteStat[]; water_types: SiteWaterType[] }

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
