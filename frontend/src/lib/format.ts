import dayjs from 'dayjs'

const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

let useBnDigits = true

export function setDigitPreference(digits: 'bn' | 'en') {
  useBnDigits = digits === 'bn'
}

export function digits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return useBnDigits ? s.replace(/\d/g, (d) => BN[Number(d)]) : s
}

export function toEnDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)))
}

export function fmtDate(value?: string | null): string {
  return value ? digits(dayjs(value).format('DD/MM/YYYY')) : '—'
}

export function fmtDateTime(value?: string | null): string {
  return value ? digits(dayjs(value).format('DD/MM/YYYY hh:mm A')) : '—'
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return digits(bytes) + ' B'
  if (bytes < 1024 * 1024) return digits((bytes / 1024).toFixed(1)) + ' KB'
  return digits((bytes / 1024 / 1024).toFixed(1)) + ' MB'
}

export const ACTION_LABELS: Record<string, string> = {
  create: 'তৈরি',
  update: 'পরিবর্তন',
  delete: 'মুছা',
  restore: 'পুনরুদ্ধার',
  login: 'লগইন',
  password_change: 'পাসওয়ার্ড পরিবর্তন',
  password_reset: 'পাসওয়ার্ড রিসেট',
  force_logout: 'জোর করে লগআউট',
  logout_all: 'সব ডিভাইস থেকে লগআউট',
  roles_change: 'রোল পরিবর্তন',
  permissions_change: 'অনুমতি পরিবর্তন',
  submit: 'অনুমোদনে পাঠানো',
  approve: 'অনুমোদন',
  reject: 'প্রত্যাখ্যান',
  return: 'ফেরত',
  auto_approve: 'স্বয়ংক্রিয় অনুমোদন',
  download: 'ডাউনলোড',
}

export const APPROVAL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'অপেক্ষমাণ', color: 'gold' },
  approved: { label: 'অনুমোদিত', color: 'green' },
  rejected: { label: 'প্রত্যাখ্যাত', color: 'red' },
  returned: { label: 'ফেরত', color: 'orange' },
}
