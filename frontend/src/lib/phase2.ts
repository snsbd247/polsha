import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { t as tx } from './i18n'

export type FarmerMeta = {
  genders: Record<string, string>
  document_types: Record<string, string>
  relations: Record<string, string>
  occupations: Record<string, string>
  cancel_reasons: Record<string, string>
}

export function useFarmerMeta() {
  return useQuery({
    queryKey: ['farmer-meta'],
    queryFn: async () => (await api.get<FarmerMeta>('/farmers/meta')).data,
    staleTime: Infinity,
  })
}

export const toOptions = (rec?: Record<string, string>) => Object.entries(rec ?? {}).map(([value, label]) => ({ value, label }))

export type MemberRef = { id: number; member_no: number; status: MemberStatus }
export type MemberStatus = 'active' | 'inactive' | 'cancelled'

export const MEMBER_STATUS: Record<MemberStatus, { label: string; color: string }> = {
  active: { label: tx('সক্রিয়'), color: 'green' },
  inactive: { label: tx('নিষ্ক্রিয়'), color: 'orange' },
  cancelled: { label: tx('বাতিলকৃত'), color: 'red' },
}

export const APPLICATION_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: tx('খসড়া'), color: 'default' },
  pending: { label: tx('অনুমোদনের অপেক্ষায়'), color: 'gold' },
  approved: { label: tx('অনুমোদিত'), color: 'green' },
  rejected: { label: tx('প্রত্যাখ্যাত'), color: 'red' },
  returned: { label: tx('সংশোধনের জন্য ফেরত'), color: 'orange' },
  cancelled: { label: tx('বাতিলকৃত'), color: 'default' },
}

export type FarmerRow = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  nid: string | null
  mobile: string | null
  village: string | null
  mouza: string | null
  is_active: boolean
  member: MemberRef | null
  photo_url: string | null
}

export type FarmerLookup = {
  id: number
  farmer_code: string
  name_bn: string
  father_name: string
  village: string | null
  village_id: number
  member_id: number | null
  member_no: number | null
}

export type DuplicateMatch = {
  id: number
  farmer_code: string
  name_bn: string
  father_name: string
  nid: string | null
  mobile: string | null
  village: string | null
  member_no: number | null
  matched: string[]
}

export const MATCH_LABEL: Record<string, string> = {
  nid: 'NID',
  mobile: tx('মোবাইল'),
  name: tx('নাম'),
  father_name: tx('পিতার নাম'),
  village: tx('গ্রাম'),
}

/** Download a protected export (CSV) with the bearer token. */
export async function downloadExport(path: string, params: Record<string, unknown>, filename: string) {
  const res = await api.get(path, { params, responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Open a protected file (document, scan) in a new tab. */
export async function openProtectedFile(path: string) {
  const res = await api.get(path, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
