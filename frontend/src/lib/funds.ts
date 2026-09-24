import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { t as tx } from './i18n'

/** Savings and share accounts run on one engine; `kind` picks the book. */
export type FundKind = 'savings' | 'share'
export const FUND_KINDS: FundKind[] = ['savings', 'share']
export const isFundKind = (k?: string): k is FundKind => k === 'savings' || k === 'share'

export const KIND_LABEL: Record<FundKind, string> = { savings: tx('সঞ্চয়'), share: tx('শেয়ার') }
export const ACCOUNTS_TITLE: Record<FundKind, string> = { savings: tx('সঞ্চয় হিসাব'), share: tx('শেয়ার মূলধন বিবরণী') }
export const HISTORY_TITLE: Record<FundKind, string> = { savings: tx('সঞ্চয়ের লেনদেন'), share: tx('শেয়ারের লেনদেন') }
export const AUDIT_TITLE: Record<FundKind, string> = { savings: tx('সঞ্চয় অডিট'), share: tx('শেয়ার মূলধন মিলকরণ') }
/** Money-in type per kind (deposit / purchase). */
export const IN_TYPE: Record<FundKind, string> = { savings: 'deposit', share: 'purchase' }

export const TXN_STATUS_COLOR: Record<string, string> = { pending: 'gold', posted: 'green', rejected: 'red', cancel_pending: 'orange', cancelled: 'default' }
export const RUN_STATUS_COLOR: Record<string, string> = { pending: 'gold', posted: 'green', rejected: 'red' }

export type Person = { id: number; name_bn: string; name_en: string | null } | null
export type FarmerBrief = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name?: string; mobile?: string | null }
export type MemberBrief = { id: number; farmer_id: number; member_no: number | string; status?: string; farmer: FarmerBrief | null }
export type AccountBrief = { id: number; account_no: string; member_id: number; member?: MemberBrief | null }

export type FundMeta = {
  types: Record<string, string>
  statuses: Record<string, string>
  directions: Record<string, string>
  methods: Record<string, string>
  account_statuses: Record<string, string>
  ledger_account: { id: number; code: string; name_bn: string; name_en: string | null }
}

export type FundTxn = {
  id: number
  txn_no: string
  member_account_id: number
  kind: FundKind
  date: string
  type: string
  direction: 'in' | 'out'
  amount: string
  balance_after: string | null
  status: string
  method: string | null
  reference: string | null
  remarks: string | null
  cancel_reason: string | null
  created_at: string
  account?: AccountBrief | null
}

export function useFundMeta(kind: FundKind) {
  return useQuery({ queryKey: ['fund-meta', kind], queryFn: async () => (await api.get<FundMeta>(`/funds/${kind}/meta`)).data, staleTime: 5 * 60_000 })
}

export const toOptions = (m?: Record<string, string>) => Object.entries(m ?? {}).map(([value, label]) => ({ value, label }))
