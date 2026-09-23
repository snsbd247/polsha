import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from 'antd'
import { api } from '../lib/api'
import { digits } from '../lib/format'
import type { FarmerLookup } from '../lib/phase2'

type Props = {
  value?: number | null
  onChange?: (id: number | null, farmer?: FarmerLookup) => void
  /** non_member: only farmers who can apply; active_member: proposer/seconder pickers */
  type?: 'non_member' | 'active_member'
  /** Return the member id instead of the farmer id (for proposer/seconder). */
  valueField?: 'id' | 'member_id'
  placeholder?: string
  initialLabel?: string
  disabled?: boolean
  exclude?: number[]
}

/** Remote-search farmer select: name, father, code, NID, mobile or member no. */
export default function FarmerPicker({ value, onChange, type, valueField = 'id', placeholder, initialLabel, disabled, exclude = [] }: Props) {
  const [term, setTerm] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['farmer-lookup', type, term],
    queryFn: async () => (await api.get<FarmerLookup[]>('/farmers/lookup', { params: { q: term, type, active_only: 1 } })).data,
  })

  const options = (data ?? [])
    .filter((f) => !exclude.includes(f[valueField] ?? 0))
    .map((f) => ({
      value: f[valueField] as number,
      label: `${f.name_bn} (${f.farmer_code}${f.member_no ? ', সদস্য নং ' + digits(f.member_no) : ''}) — পিতা: ${f.father_name}${f.village ? ', ' + f.village : ''}`,
      farmer: f,
    }))
  if (value && initialLabel && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: initialLabel, farmer: undefined as unknown as FarmerLookup })
  }

  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setTerm }}
      allowClear
      disabled={disabled}
      loading={isFetching}
      value={value ?? undefined}
      placeholder={placeholder ?? 'নাম, Farmer ID, NID, মোবাইল বা সদস্য নং দিয়ে খুঁজুন'}
      options={options}
      notFoundContent={isFetching ? 'খোঁজা হচ্ছে…' : 'কাউকে পাওয়া যায়নি'}
      onChange={(v, opt) => onChange?.(v ?? null, (opt as { farmer?: FarmerLookup } | undefined)?.farmer)}
      style={{ width: '100%' }}
    />
  )
}
