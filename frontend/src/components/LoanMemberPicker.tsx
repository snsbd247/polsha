import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from 'antd'
import { api } from '../lib/api'
import { money } from '../lib/accounting'
import { digits } from '../lib/format'
import type { LoanMember } from '../lib/loans'
import { nameOf, t as tx } from '../lib/i18n'

type Props = {
  value?: number | null
  onChange?: (id: number | null, row?: LoanMember) => void
  /** borrower: shows deposits and any open loan; guarantor: shows guarantees in use. */
  mode: 'borrower' | 'guarantor'
  exclude?: number[]
}

/** Remote-search member select for loan applications. */
export default function LoanMemberPicker({ value, onChange, mode, exclude = [] }: Props) {
  const [term, setTerm] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['loan-members', term],
    queryFn: async () => (await api.get<LoanMember[]>('/loans/members', { params: { search: term } })).data,
  })
  const rows = (data ?? []).filter((m) => m.id === value || !exclude.includes(m.id))

  const extra = (m: LoanMember) =>
    mode === 'borrower'
      ? ` · ${tx('সঞ্চয়')} ৳${money(m.savings)}, ${tx('শেয়ার')} ৳${money(m.share)}` + (m.open_loan ? ` · ${tx('চলমান ঋণ')} ${digits(m.open_loan.loan_no)}` : '')
      : ` · ${tx('জামিনদার: {{p0}}টি ঋণে', { p0: digits(m.guarantees) })}`

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
        disabled: m.status !== 'active',
        label: tx('সদস্য নং {{p0}} — {{p1}}', { p0: digits(m.member_no), p1: nameOf(m.farmer) }) + extra(m),
      }))}
      onChange={(v, opt) => onChange?.(v ?? null, (opt as { row?: LoanMember } | undefined)?.row)}
      style={{ width: '100%' }}
    />
  )
}
