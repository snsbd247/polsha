import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { ReceiptFund } from './irrigation'
import { t as tx } from './i18n'

/** journals.module → what the cashier sees in the day summary. */
export const JOURNAL_MODULE_LABEL: Record<string, string> = {
  accounting: tx('হিসাব (সাধারণ)'),
  cash: tx('নগদ'),
  bank: tx('ব্যাংক'),
  irrigation: tx('সেচ'),
  loan: tx('ঋণ'),
  share: tx('শেয়ার'),
  savings: tx('সঞ্চয়'),
  asset: tx('সম্পদ'),
  fund: tx('তহবিল'),
}

export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]

export type CombinedModule = 'loan' | 'irrigation' | 'share' | 'savings'
export const COMBINED_MODULES: CombinedModule[] = ['loan', 'irrigation', 'share', 'savings']
/** Tag tone per money head (the fl-tag / ll-* classes), same colours as the combined list cards. */
export const MODULE_TONE: Record<string, string> = { irrigation: 'll-blue', loan: 'fl-tag-red', savings: 'fl-tag-green', share: 'll-purple' }

export type CombinedQuote = {
  farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null }
  member: { id: number; member_no: number; status: string } | null
  member_active: boolean
  loan: { id: number; loan_no: string; due_now: number; payoff: number; overdue: number; penalty: number; payable: boolean } | null
  irrigation: { due: number; invoices: { id: number; invoice_no: string; season: { name_bn: string; name_en: string | null } | null; due: number }[] }
  share: { account_no: string | null; balance: number; min: number; due: number }
  savings: { account_no: string | null; balance: number }
  order: ('loan' | 'irrigation' | 'share')[]
  allocation: { parts: Record<CombinedModule, number>; unallocated: number }
  modules: Record<CombinedModule, string>
}

export const REC_STATUS_COLOR: Record<string, string> = { draft: 'gold', finalized: 'green' }
export const ASSET_STATUS_COLOR: Record<string, string> = {
  in_stock: 'blue',
  installed: 'green',
  in_repair: 'orange',
  disposal_pending: 'gold',
  disposed: 'default',
  sold: 'default',
}
export const CONDITION_COLOR: Record<string, string> = { good: 'green', fair: 'blue', poor: 'orange', damaged: 'red' }
export const MAINT_STATUS_COLOR: Record<string, string> = { scheduled: 'blue', done: 'green', cancelled: 'default' }

export type AssetCategory = {
  id: number
  code: string
  name_bn: string
  name_en: string | null
  life_months: number
  salvage_percent: string
  is_active: boolean
  description?: string | null
  assets_count?: number
}

export type AssetMeta = {
  statuses: Record<string, string>
  conditions: Record<string, string>
  acquisitions: Record<string, string>
  movement_types: Record<string, string>
  maintenance_kinds: Record<string, string>
  maintenance_statuses: Record<string, string>
  categories: AssetCategory[]
}

export function useAssetMeta() {
  return useQuery({ queryKey: ['asset-meta'], queryFn: async () => (await api.get<AssetMeta>('/assets/meta')).data, staleTime: 5 * 60_000 })
}

export function useAssetFunds() {
  return useQuery({ queryKey: ['asset-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/assets/funds')).data })
}

/** "{origin}/q/{type}/{code}" — what every QR label carries. */
export const qrUrl = (type: string, code: string) => `${window.location.origin}/q/${type}/${encodeURIComponent(code)}`

/** Reads a scanned text back into type + code; accepts our label URLs, receipt verify URLs or "type:code". */
export function parseQr(text: string): { type: string; code: string } | null {
  const s = text.trim()
  const m = s.match(/\/q\/([a-z]+)\/([^/?#]+)/i) ?? s.match(/\/verify\/(receipt|combined)\/([^/?#]+)/i) ?? s.match(/^([a-z]+):(.+)$/i)
  return m ? { type: m[1].toLowerCase(), code: decodeURIComponent(m[2]) } : null
}
