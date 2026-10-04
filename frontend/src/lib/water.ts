import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { api } from './api'
import { lang, t as tx } from './i18n'
import { digits } from './format'

export type WaterType = {
  id: number
  code: string
  name_bn: string
  name_en: string | null
  monthly_fee: string
  connection_fee: string
  is_active: boolean
  sort_order: number
  connections_count?: number
  active_count?: number
}

export type WaterConnection = {
  id: number
  connection_no: string
  type_id: number
  /** set when the customer is a registered farmer */
  farmer_id: number | null
  farmer?: { id: number; farmer_code: string; name_bn?: string; name_en?: string | null } | null
  name_bn: string
  name_en: string | null
  father_name: string | null
  mobile: string | null
  nid: string | null
  village_id: number | null
  address: string | null
  monthly_fee: string | null
  connected_on: string
  status: 'active' | 'disconnected' | 'closed'
  status_date: string | null
  status_reason: string | null
  remarks: string | null
  type?: { id: number; code: string; name_bn: string; name_en: string | null; monthly_fee: string } | null
  village?: { id: number; name_bn: string; name_en: string | null } | null
  due?: number | string
}

/** What a bill copies from its connection when it is made. */
export type BillSnapshot = {
  connection_no: string
  name_bn: string
  name_en: string | null
  father_name: string | null
  mobile: string | null
  address: string | null
  village: string | null
  village_en: string | null
  type: string | null
  type_en: string | null
}

export type WaterBill = {
  id: number
  bill_no: string
  connection_id: number
  kind: 'monthly' | 'connection' | 'reconnection' | 'opening'
  period: string | null
  bill_date: string
  due_date: string | null
  amount: number
  penalty: number
  paid_amount: number
  due: number
  status: 'unpaid' | 'partial' | 'paid' | 'cancelled'
  snapshot: BillSnapshot
}

export type WaterMeta = {
  types: WaterType[]
  statuses: Record<string, string>
  bill_statuses: Record<string, string>
  kinds: Record<string, string>
  methods: Record<string, string>
}

export function useWaterMeta() {
  return useQuery({ queryKey: ['water-meta'], queryFn: async () => (await api.get<WaterMeta>('/water/meta')).data, staleTime: 5 * 60_000 })
}

export const CONNECTION_STATUS_TONE: Record<string, string> = { active: 'fl-tag-green', disconnected: 'fl-tag-red', closed: '' }
export const BILL_STATUS_COLOR: Record<string, string> = { unpaid: 'red', partial: 'orange', paid: 'green', cancelled: 'default' }

/** "2026-10" → "অক্টোবর ২০২৬" / "October 2026". */
export function monthLabel(period?: string | null): string {
  if (!period) return ''
  const d = dayjs(`${period}-01`)
  return digits(d.locale(lang === 'en' ? 'en' : 'bn').format('MMMM YYYY'))
}

/** What a bill is for: the month of a monthly bill, else the fee's name. */
export function billLabel(b: { kind: string; period: string | null }): string {
  if (b.kind === 'monthly') return monthLabel(b.period)
  if (b.kind === 'opening') return tx('পুরনো বকেয়া')
  return b.kind === 'connection' ? tx('সংযোগ ফি') : tx('পুনঃসংযোগ ফি')
}

/** A connection's monthly fee: its own if set, else its type's. */
export const feeOf = (c: Pick<WaterConnection, 'monthly_fee' | 'type'>) => Number(c.monthly_fee ?? c.type?.monthly_fee ?? 0)
