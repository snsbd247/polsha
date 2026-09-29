import type { FundKind } from './funds'
import { t as tx } from './i18n'

/**
 * The savings menu's entry screens run on one set of pages: a savings
 * deposit, a share collection and a withdrawal differ only in the book,
 * the transaction type and the words.
 */
export type EntryKey = 'deposit' | 'share'

export type EntryConfig = {
  key: EntryKey
  kind: FundKind
  type: string
  base: string
  group: string
  list: string
  add: string
  detail: string
  history: string
  no: string
  section: string
  noun: string
  /** history events worth a card of their own */
  events: string[]
}

export const ENTRY: Record<EntryKey, EntryConfig> = {
  deposit: {
    key: 'deposit',
    kind: 'savings',
    type: 'deposit',
    base: '/savings/entries',
    group: tx('সঞ্চয় জমা'),
    list: tx('জমার তালিকা'),
    add: tx('নতুন জমা'),
    detail: tx('জমার বিস্তারিত'),
    history: tx('জমার ইতিহাস'),
    no: tx('জমা নং'),
    section: tx('জমার বিবরণ'),
    noun: tx('জমা'),
    events: ['entered', 'cancel_requested', 'cancel_rejected', 'cancelled'],
  },
  share: {
    key: 'share',
    kind: 'share',
    type: 'purchase',
    base: '/savings/shares',
    group: tx('শেয়ার আদায়'),
    list: tx('শেয়ার আদায়ের তালিকা'),
    add: tx('নতুন শেয়ার আদায়'),
    detail: tx('শেয়ার আদায়ের বিস্তারিত'),
    history: tx('শেয়ার আদায়ের ইতিহাস'),
    no: tx('আদায় নং'),
    section: tx('আদায়ের বিবরণ'),
    noun: tx('আদায়'),
    events: ['entered', 'cancel_requested', 'cancel_rejected', 'cancelled'],
  },
}

export type EntrySummary = { count: number; amount: number; today_count: number; today_amount: number; month_amount: number; members: number; pending: number; cancelled: number }

export type HistoryRow = {
  id: number
  event: string | null
  event_label: string
  at: string
  by: { id: number; name_bn: string; name_en: string | null } | null
  reason: string | null
  transaction: {
    id: number
    txn_no: string
    date: string
    type: string
    amount: number
    status: string
    method: string | null
    account: { id: number; account_no: string; member_no: number | string | null; farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null } | null } | null
  } | null
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
