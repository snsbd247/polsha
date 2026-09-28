import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { lang, t as tx } from './i18n'

export type Named = { id: number; name_bn: string }
export type Person = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile?: string | null }
export type Owner = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; share_percent: number }

export type Season = {
  id: number
  name_bn: string
  code: string | null
  type: string | null
  crop: string | null
  start_date: string
  end_date: string
  due_date: string | null
  status: 'planned' | 'open' | 'closed'
  remarks: string | null
  invoice_count: number
  billed: number
  collected: number
}

export type InvoiceMeta = {
  seasons: (Named & { status: string; start_date: string; end_date: string; due_date: string | null })[]
  irrigation_types: Named[]
  statuses: Record<string, string>
  cultivation_types: Record<string, string>
  skip_reasons: Record<string, string>
}

export type InvoiceRow = {
  id: number
  invoice_no: string
  invoice_date: string
  due_date: string | null
  season_id: number
  season: string | null
  land_id: number
  land_code: string | null
  farmer_id: number
  cultivator: Person | null
  owners: Owner[]
  cultivation_type: string
  mouza: string | null
  mouza_en: string | null
  survey: string | null
  dag_no: string | null
  khatian_no: string | null
  land_type: string | null
  irrigation_type: string | null
  area_decimal: number
  rate: number
  amount: number
  paid_amount: number
  due: number
  status: string
}

export type DueInvoice = {
  id: number
  invoice_no: string
  invoice_date: string
  due_date: string | null
  season: string | null
  mouza: string | null
  dag_no: string | null
  area_decimal: number
  amount: number
  paid_amount: number
  due: number
  cultivation_type: string
}

export type ReceiptFund = { id: number; key: string | null; code: string; name_bn: string; name_en: string | null; kind: 'cash' | 'bank'; account_no: string | null }

export function useInvoiceMeta() {
  return useQuery({
    queryKey: ['invoice-meta'],
    queryFn: async () => (await api.get<InvoiceMeta>('/invoices/meta')).data,
    staleTime: 60_000,
  })
}

export const SEASON_STATUS_COLOR: Record<string, string> = { planned: 'blue', open: 'green', closed: 'default' }
export const RATE_STATUS_COLOR: Record<string, string> = { pending: 'gold', approved: 'green', rejected: 'red' }
export const INVOICE_STATUS_COLOR: Record<string, string> = { unpaid: 'red', partial: 'orange', paid: 'green', cancelled: 'default' }
export const RECEIPT_STATUS_COLOR: Record<string, string> = { active: 'green', cancel_pending: 'gold', cancelled: 'red' }

export const RECEIPT_STATUS_LABEL: Record<string, string> = {
  active: tx('বৈধ'),
  cancel_pending: tx('বাতিলের অপেক্ষায়'),
  cancelled: tx('বাতিলকৃত'),
}

export const METHOD_LABEL: Record<string, string> = {
  cash: tx('নগদ'),
  bank: tx('ব্যাংক'),
  other: tx('অন্যান্য (মোবাইল ব্যাংকিং ইত্যাদি)'),
}

/** Round to paisa so repeated additions of decimals don't drift. */
export const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Oldest-first allocation of a lump sum across open bills — what a clerk does
 * by hand when a farmer hands over cash without saying which bill it is for.
 */
export function allocate(total: number, dues: { id: number; due: number }[]): Record<number, number> {
  let left = round2(total)
  const out: Record<number, number> = {}
  for (const d of dues) {
    const take = round2(Math.min(left, d.due))
    out[d.id] = take > 0 ? take : 0
    left = round2(left - out[d.id])
  }
  return out
}

// ---- amount in words (Bangla / English, South Asian grouping) ----

const BN_WORDS = (
  'শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোল সতেরো আঠারো উনিশ বিশ ' +
  'একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আটাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ চল্লিশ ' +
  'একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট ষাট ' +
  'একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি ' +
  'একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি আটাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই'
).split(' ')

const EN_ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ')
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function under100(n: number): string {
  if (lang === 'bn') return BN_WORDS[n]
  if (n < 20) return EN_ONES[n]
  return EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : '')
}

function intWords(n: number): string {
  if (n === 0) return under100(0)
  const units: [number, string, string][] = [
    [10_000_000, 'কোটি', 'crore'],
    [100_000, 'লক্ষ', 'lakh'],
    [1000, 'হাজার', 'thousand'],
    [100, 'শত', 'hundred'],
  ]
  const parts: string[] = []
  for (const [size, bn, en] of units) {
    if (n >= size) {
      const q = Math.floor(n / size)
      // Crores can exceed 99, so recurse for the multiplier.
      parts.push(`${size === 10_000_000 ? intWords(q) : under100(q)} ${lang === 'bn' ? bn : en}`)
      n %= size
    }
  }
  if (n > 0) parts.push(under100(n))
  return parts.join(' ')
}

/** "এক হাজার দুই শত পঞ্চাশ টাকা মাত্র" / "One thousand two hundred fifty taka only". */
export function amountInWords(amount: number): string {
  const taka = Math.floor(Math.abs(amount))
  const paisa = Math.round((Math.abs(amount) - taka) * 100)
  if (lang === 'bn') return `${intWords(taka)} টাকা${paisa ? ` ${intWords(paisa)} পয়সা` : ''} মাত্র`
  const s = `${intWords(taka)} taka${paisa ? ` and ${intWords(paisa)} paisa` : ''} only`
  return s.charAt(0).toUpperCase() + s.slice(1)
}
