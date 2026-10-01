import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { digits } from './format'
import type { FarmerBrief, MemberBrief, Person } from './funds'
import { t } from './i18n'

export type LoanMeta = {
  statuses: Record<string, string>
  payment_statuses: Record<string, string>
  categories: Record<string, string>
  methods: Record<string, string>
  frequencies: Record<string, string>
  penalty_types: Record<string, string>
  penalty_labels: Record<string, string>
  buckets: Record<string, string>
  pay_methods: Record<string, string>
  max_guarantees: number
}

export type LoanProduct = {
  id: number
  code: string
  name_bn: string
  name_en: string | null
  category: string
  max_amount: string
  savings_multiplier: string | null
  interest_rate: string
  interest_method: 'flat' | 'declining'
  frequency: 'monthly' | 'weekly' | 'quarterly' | 'one_time'
  installments: number
  term_months: number | null
  penalty_type: PenaltyType
  penalty_rate: string
  grace_days: number
  guarantors_required: number
  is_active: boolean
  description: string | null
  running?: number
}

export type ScheduleRow = { seq: number; due_date: string; principal: number; interest: number }

export type Installment = {
  id: number
  seq: number
  due_date: string
  principal: string
  interest: string
  principal_paid: string
  interest_paid: string
  penalty_paid: string
  paid_on: string | null
  total: number
  outstanding: number
  penalty_due: number
  overdue: boolean
  state: 'paid' | 'overdue' | 'partial' | 'due'
}

export type Position = {
  as_of: string
  installments: Installment[]
  principal_outstanding: number
  interest_outstanding: number
  penalty_due: number
  principal_paid: number
  interest_paid: number
  penalty_paid: number
  overdue_amount: number
  due_now: number
  payoff: number
  days_overdue: number
  oldest_overdue: string | null
  bucket: string | null
}

export type LoanPayment = {
  id: number
  payment_no: string
  loan_id: number
  date: string
  amount: string
  penalty: string
  interest: string
  principal: string
  principal_after: string
  method: string
  reference: string | null
  remarks: string | null
  status: string
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  creator?: Person
  loan?: { id: number; loan_no: string; member_id: number; member?: MemberBrief | null } | null
}

export type LoanRow = {
  id: number
  loan_no: string
  member_id: number
  product_id: number
  applied_on: string
  amount: string
  purpose: string | null
  interest_rate: string
  interest_method: string
  frequency: string
  installments: number
  term_months: number | null
  penalty_type: PenaltyType | 'daily'
  penalty_rate: string
  grace_days: number
  limit_amount: string
  status: string
  disbursed_on: string | null
  first_due_on: string | null
  closed_on: string | null
  total_interest: string
  principal_outstanding?: number | null
  member: (MemberBrief & { farmer: (FarmerBrief & { father_name: string; mobile: string | null }) | null }) | null
  product: Pick<LoanProduct, 'id' | 'code' | 'name_bn' | 'name_en'> | null
}

/** A member as the loan pickers see them: deposits, open loan and guarantees in use. */
export type LoanMember = {
  id: number
  member_no: number | string
  status: string
  farmer: FarmerBrief | null
  savings: number
  share: number
  open_loan: { id: number; loan_no: string; status: string } | null
  guarantees: number
}

export type Eligibility = {
  product_max: number
  savings: number
  share: number
  multiplier: number | null
  by_deposit: number | null
  limit: number
  member_status: string
  open_loan: { id: number; loan_no: string; status: string } | null
}

export type PenaltyType = 'fixed' | 'percent'

/** The late-payment penalty in words: "৳50 per late instalment", "2% of a late instalment (once)", or the old day-by-day rule. */
export function penaltyText(l: { penalty_type?: string | null; penalty_rate: string | number; grace_days: number }): string {
  const rate = Number(l.penalty_rate)
  if (!rate) return t('জরিমানা নেই')
  const grace = l.grace_days ? ` · ${t('ছাড় {{p0}} দিন', { p0: digits(l.grace_days) })}` : ''
  const text = l.penalty_type === 'fixed' ? t('প্রতি দেরি কিস্তিতে ৳{{p0}}', { p0: digits(rate) }) : l.penalty_type === 'percent' ? t('দেরি কিস্তির {{p0}}% (একবার)', { p0: digits(rate) }) : t('{{p0}}%/মাস, দিন হিসাবে', { p0: digits(rate) })
  return text + grace
}

/** Instalment count and kind in words: "12 × monthly" or "one-time — 6 months". */
export function termsText(l: { frequency: string; installments: number | null; term_months: number | null }, frequencies?: Record<string, string>): string {
  const kind = frequencies?.[l.frequency] ?? l.frequency
  return l.frequency === 'one_time' ? `${kind} — ${t('{{p0}} মাস', { p0: digits(l.term_months ?? '') })}` : `${digits(l.installments ?? '')} × ${kind}`
}

export const LOAN_STATUS_COLOR: Record<string, string> = { pending: 'gold', approved: 'blue', active: 'green', closed: 'default', rejected: 'red', cancelled: 'default' }
export const PAYMENT_STATUS_COLOR: Record<string, string> = { posted: 'green', cancel_pending: 'orange', cancelled: 'default' }
export const INSTALLMENT_COLOR: Record<string, string> = { paid: 'green', overdue: 'red', partial: 'orange', due: 'default' }
export const BUCKET_COLOR: Record<string, string> = { '1_30': 'gold', '31_90': 'orange', '90_plus': 'red' }

export function useLoanMeta() {
  return useQuery({ queryKey: ['loan-meta'], queryFn: async () => (await api.get<LoanMeta>('/loans/meta')).data, staleTime: 5 * 60_000 })
}

export function useLoanProducts(active = false) {
  return useQuery({ queryKey: ['loan-products', active], queryFn: async () => (await api.get<LoanProduct[]>('/loan-products', { params: { active: active ? 1 : undefined } })).data })
}
