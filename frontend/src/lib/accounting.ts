import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { digits, toEnDigits } from './format'
import { nameOf, t as tx } from './i18n'

export type AccountOption = { id: number; key: string | null; code: string; name_bn: string; name_en: string | null; type: string; is_fund: boolean; is_cash: boolean }

export type Fund = {
  id: number
  key: string | null
  code: string
  name_bn: string
  name_en: string | null
  kind: 'cash' | 'bank'
  bank: { id: number; bank_name: string; branch_name: string | null; account_no: string; account_type: string; is_active: boolean } | null
  opening: number
  receipts: number
  payments: number
  closing: number
}

export type LedgerRow = {
  line_id: number
  journal_id: number
  date: string
  voucher_no: string
  voucher_type: string
  narration: string | null
  remarks: string | null
  against: { id: number; code: string; name_bn: string; name_en: string | null }[]
  debit: number
  credit: number
  balance: number
  reconciled_at: string | null
}

export type LedgerReport = {
  account: { id: number; key: string | null; code: string; name_bn: string; name_en: string | null; type: string }
  from: string
  to: string
  opening: number
  rows: LedgerRow[]
  total_debit: number
  total_credit: number
  closing: number
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: tx('সম্পদ'),
  liability: tx('দায়'),
  equity: tx('মূলধন ও তহবিল'),
  income: tx('আয়'),
  expense: tx('ব্যয়'),
}

export const VOUCHER_TYPE_LABEL: Record<string, string> = {
  journal: tx('জার্নাল'),
  opening: tx('প্রারম্ভিক জের'),
  receipt: tx('প্রাপ্তি'),
  payment: tx('পরিশোধ'),
  contra: tx('কন্ট্রা (স্থানান্তর)'),
}

export const JOURNAL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: tx('অনুমোদনের অপেক্ষায়'), color: 'gold' },
  posted: { label: tx('পোস্টেড'), color: 'green' },
  rejected: { label: tx('প্রত্যাখ্যাত'), color: 'red' },
  returned: { label: tx('ফেরত'), color: 'orange' },
  reversed: { label: tx('রিভার্সড'), color: 'default' },
}

export const BANK_TYPE_LABEL: Record<string, string> = {
  current: tx('চলতি হিসাব'),
  savings: tx('সঞ্চয়ী হিসাব'),
  fdr: tx('এফডিআর'),
}

/** "১২,৩৪৫.০০" — grouped, two decimals, digits per language setting. */
export function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0) || 0 // folds -0 (a zero credit-nature balance) into 0
  return digits(n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
}

/** Money cell that shows blanks for zero (ledger debit/credit columns). */
export const moneyOrBlank = (v: number) => (Number(v) ? money(v) : '')

export const accountLabel = (a?: { code: string; name_bn: string; name_en?: string | null } | null) => (a ? `${digits(a.code)} — ${nameOf(a)}` : '')

export function useAccountOptions() {
  return useQuery({
    queryKey: ['account-options'],
    queryFn: async () => (await api.get<AccountOption[]>('/accounts/options')).data,
    staleTime: 60_000,
  })
}

export function useFunds(date?: string) {
  return useQuery({
    queryKey: ['funds', date ?? 'today'],
    queryFn: async () => (await api.get<Fund[]>('/funds', { params: { date } })).data,
  })
}

/** antd Select filter that matches code, Bangla and English names. */
// Codes are shown in Bangla digits, but people type them either way.
export const accountFilter = (input: string, option?: { label?: unknown }) =>
  toEnDigits(String(option?.label ?? '')).toLowerCase().includes(toEnDigits(input).toLowerCase())
