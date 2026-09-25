import dayjs from 'dayjs'
import { lang, t as tx } from './i18n'

const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

// English UI always shows Western digits; Bangla UI follows the society setting.
let useBnDigits = lang === 'bn'

export function setDigitPreference(digits: 'bn' | 'en') {
  useBnDigits = lang === 'bn' && digits === 'bn'
}

export function digits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return useBnDigits ? s.replace(/\d/g, (d) => BN[Number(d)]) : s
}

export function toEnDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)))
}

// date layout chosen in General Settings
export const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'] as const
let dateFormat: string = 'DD/MM/YYYY'

export function setDateFormat(format?: string) {
  if (format && (DATE_FORMATS as readonly string[]).includes(format)) dateFormat = format
}

export function fmtDate(value?: string | null): string {
  return value ? digits(dayjs(value).format(dateFormat)) : '—'
}

export function fmtDateTime(value?: string | null): string {
  return value ? digits(dayjs(value).format(dateFormat + ' hh:mm A')) : '—'
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return digits(bytes) + ' B'
  if (bytes < 1024 * 1024) return digits((bytes / 1024).toFixed(1)) + ' KB'
  return digits((bytes / 1024 / 1024).toFixed(1)) + ' MB'
}

export const ACTION_LABELS: Record<string, string> = {
  create: tx('তৈরি'),
  update: tx('পরিবর্তন'),
  delete: tx('মুছা'),
  restore: tx('পুনরুদ্ধার'),
  login: tx('লগইন'),
  password_change: tx('পাসওয়ার্ড পরিবর্তন'),
  password_reset: tx('পাসওয়ার্ড রিসেট'),
  force_logout: tx('জোর করে লগআউট'),
  logout_all: tx('সব ডিভাইস থেকে লগআউট'),
  roles_change: tx('রোল পরিবর্তন'),
  permissions_change: tx('অনুমতি পরিবর্তন'),
  submit: tx('অনুমোদনে পাঠানো'),
  approve: tx('অনুমোদন'),
  reject: tx('প্রত্যাখ্যান'),
  return: tx('ফেরত'),
  auto_approve: tx('স্বয়ংক্রিয় অনুমোদন'),
  download: tx('ডাউনলোড'),
}

export const APPROVAL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: tx('অপেক্ষমাণ'), color: 'gold' },
  approved: { label: tx('অনুমোদিত'), color: 'green' },
  rejected: { label: tx('প্রত্যাখ্যাত'), color: 'red' },
  returned: { label: tx('ফেরত'), color: 'orange' },
}
