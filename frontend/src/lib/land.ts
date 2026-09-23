import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { digits } from './format'

export type LandMeta = {
  surveys: Record<string, string>
  statuses: Record<string, string>
  cultivation_types: Record<string, string>
  units: Record<string, string>
  unit_factors: Record<string, number>
  land_types: { id: number; name_bn: string; category: string | null }[]
}

export function useLandMeta() {
  return useQuery({
    queryKey: ['land-meta'],
    queryFn: async () => (await api.get<LandMeta>('/lands/meta')).data,
    staleTime: 5 * 60_000,
  })
}

const num = (n: number, max = 2) => digits(Number(n.toFixed(max)).toString())

/** "৩৩ শতক" plus the bigha/acre equivalent when it's a sensible size. */
export function fmtArea(decimal: number | string | null | undefined, meta?: LandMeta): string {
  const d = Number(decimal ?? 0)
  const base = `${num(d)} শতক`
  if (!meta || d <= 0) return base
  const bigha = meta.unit_factors.bigha
  if (d >= 100) return `${base} (${num(d / 100)} একর)`
  if (bigha && d >= bigha / 2) return `${base} (${num(d / bigha)} বিঘা)`
  return base
}

export const CULTIVATION_COLOR: Record<string, string> = { own: 'green', borga: 'orange', lease: 'blue' }
export const LAND_STATUS_COLOR: Record<string, string> = { cultivated: 'green', fallow: 'default', disputed: 'red', inactive: 'default' }

export type OwnerRow = { id: number; farmer_id: number; farmer_code: string; name_bn: string; father_name: string; share_percent: number; start_date: string }
export type CultivationRow = {
  id: number
  farmer_id: number
  farmer_code: string
  name_bn: string
  father_name: string
  type: 'own' | 'borga' | 'lease'
  terms: string | null
  start_date: string
}

export type LandRow = {
  id: number
  land_code: string
  mouza: string | null
  jl_no: string | null
  survey: string
  khatian_no: string
  dag_no: string
  area_decimal: number
  land_type: string | null
  status: string
  owners: OwnerRow[]
  cultivation: CultivationRow | null
}
