import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from 'antd'
import { api } from '../lib/api'
import { money } from '../lib/accounting'
import { digits } from '../lib/format'
import type { FarmerBrief, FundKind } from '../lib/funds'
import { nameOf, t as tx } from '../lib/i18n'

export type FundLookup = {
  id: number
  member_no: number | string
  status: string
  farmer: FarmerBrief | null
  account: { id: number; account_no: string; balance: number; status: string } | null
}

type Props = {
  kind: FundKind
  value?: number | null
  onChange?: (id: number | null, row?: FundLookup) => void
  /** without: members with no account of this kind yet (for opening one). */
  filter?: 'without' | 'with'
  exclude?: number[]
}

/** Remote-search member select that also shows the member's account of `kind`. */
export default function FundMemberPicker({ kind, value, onChange, filter, exclude = [] }: Props) {
  const [term, setTerm] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['fund-lookup', kind, term],
    queryFn: async () => (await api.get<FundLookup[]>(`/funds/${kind}/lookup`, { params: { search: term } })).data,
  })
  const rows = (data ?? []).filter((m) => !exclude.includes(m.id) && (filter === 'without' ? !m.account : filter === 'with' ? !!m.account : true))

  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setTerm }}
      allowClear
      loading={isFetching}
      value={value ?? undefined}
      placeholder={tx('নাম, সদস্য নং, Farmer ID বা মোবাইল দিয়ে খুঁজুন')}
      notFoundContent={isFetching ? tx('খোঁজা হচ্ছে…') : tx('কাউকে পাওয়া যায়নি')}
      options={rows.map((m) => ({
        value: m.id,
        row: m,
        label:
          tx('সদস্য নং {{p0}} — {{p1}}', { p0: digits(m.member_no), p1: nameOf(m.farmer) }) +
          (m.farmer?.father_name ? ` (${tx('পিতা: {{p0}}', { p0: m.farmer.father_name })})` : '') +
          (m.account ? ` · ${digits(m.account.account_no)}: ৳${money(m.account.balance)}` : ''),
      }))}
      onChange={(v, opt) => onChange?.(v ?? null, (opt as { row?: FundLookup } | undefined)?.row)}
      style={{ width: '100%' }}
    />
  )
}
