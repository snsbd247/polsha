import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { setDateFormat, setDigitPreference } from './format'
import { hasStoredLang, lang, setLang } from './i18n'

export type PublicSettings = {
  society_name_bn: string
  society_name_en: string
  logo: string | null
  digits: 'bn' | 'en'
  brand_color?: string
  default_locale?: 'bn' | 'en'
  page_size?: number
  idle_logout_minutes?: number
  member_card_note?: string
  date_format?: string
  default_location?: number[]
  default_mouza_id?: number | null
}

export const DEFAULT_BRAND = '#1f7a4d'

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: async () => {
      const r = await api.get<PublicSettings>('/public/settings')
      setDigitPreference(r.data.digits)
      setDateFormat(r.data.date_format)
      // a device with no language chosen yet starts in the society's default language
      if (!hasStoredLang() && r.data.default_locale && r.data.default_locale !== lang) setLang(r.data.default_locale)
      return r.data
    },
    staleTime: 5 * 60_000,
  })
}

export const logoUrl = () => `${import.meta.env.VITE_API_URL}/public/logo`

/** Signature/seal images need the bearer token, so they are fetched as blobs (see ProtectedImage). */
export const settingImagePath = (slot: 'logo' | 'signature' | 'seal') => `${import.meta.env.VITE_API_URL}/settings/images/${slot}`

/** Society header + print options sent with every printable document. */
export type Society = {
  name_bn: string
  name_en: string | null
  address: string | null
  phone: string | null
  email?: string | null
  registration_no: string | null
  logo: string | null
  letterhead_text?: string
  brand_color?: string
  signature?: boolean
  seal?: boolean
  sign_left?: string
  sign_right?: string
  footer_note?: string
  document_footer?: string
  show_qr?: boolean
  show_due?: boolean
  copies?: number
  paper?: 'a4' | 'a5' | 'thermal'
  member_card_note?: string
}
