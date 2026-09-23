import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { setDigitPreference } from './format'

export type PublicSettings = {
  society_name_bn: string
  society_name_en: string
  logo: string | null
  digits: 'bn' | 'en'
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: async () => {
      const r = await api.get<PublicSettings>('/public/settings')
      setDigitPreference(r.data.digits)
      return r.data
    },
    staleTime: 5 * 60_000,
  })
}

export const logoUrl = () => `${import.meta.env.VITE_API_URL}/public/logo`
