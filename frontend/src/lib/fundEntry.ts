import type { FundKind } from './funds'
import { t as tx } from './i18n'

/**
 * The savings menu's two transaction lists run on one set of pages: a share
 * collection and a savings withdrawal differ only in the book, the
 * transaction type and the words. (Savings deposits are taken from the
 * account list.)
 */
export type EntryKey = 'share' | 'withdrawal'

export type EntryConfig = {
  key: EntryKey
  kind: FundKind
  type: string
  base: string
  list: string
  add: string
  detail: string
  no: string
  section: string
  noun: string
  /** money going out: needs approval, cannot exceed the available balance */
  out?: boolean
  /** who entered it, as the list column calls them */
  by: string
}

export const ENTRY: Record<EntryKey, EntryConfig> = {
  share: {
    key: 'share',
    kind: 'share',
    type: 'purchase',
    base: '/savings/shares',
    list: tx('শেয়ার আদায়ের তালিকা'),
    add: tx('নতুন শেয়ার আদায়'),
    detail: tx('শেয়ার আদায়ের বিস্তারিত'),
    no: tx('আদায় নং'),
    section: tx('আদায়ের বিবরণ'),
    noun: tx('আদায়'),
    by: tx('আদায়কারী'),
  },
  withdrawal: {
    key: 'withdrawal',
    kind: 'savings',
    type: 'withdrawal',
    base: '/savings/withdrawals',
    list: tx('উত্তোলনের তালিকা'),
    add: tx('নতুন উত্তোলন'),
    detail: tx('উত্তোলনের বিস্তারিত'),
    no: tx('উত্তোলন নং'),
    section: tx('উত্তোলনের বিবরণ'),
    noun: tx('উত্তোলন'),
    out: true,
    by: tx('এন্ট্রিকারী'),
  },
}

export type EntrySummary = {
  count: number
  amount: number
  today_count: number
  today_amount: number
  month_amount: number
  members: number
  pending: number
  pending_amount: number
  approved_today: number
  rejected: number
  cancelled: number
}

/** Status tag tone on the approved list designs. */
export const TXN_TONE: Record<string, string> = { posted: 'fl-tag-green', pending: 'fl-tag-gold', cancel_pending: 'fl-tag-gold', rejected: 'fl-tag-red', cancelled: 'll-gray' }
/** History event tag tone. */
export const EVENT_TONE: Record<string, string> = {
  entered: 'll-green',
  submitted: 'll-blue',
  approved: 'll-green',
  rejected: 'hs-red',
  cancel_requested: 'll-orange',
  cancel_rejected: 'll-purple',
  cancelled: 'hs-red',
}
