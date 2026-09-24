import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, Input, Table } from 'antd'
import { api, type Paginated } from '../lib/api'
import { money } from '../lib/accounting'
import { digits } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'

type Kind = 'land' | 'loan'
type LandHit = { id: number; land_code: string; mouza: string; khatian_no: string; dag_no: string; owners: { id: number; name_bn: string }[] }
type LoanHit = { id: number; loan_no: string; amount: string; member: { member_no: number | string; farmer: { name_bn: string; name_en: string | null } | null } | null }

const CFG: Record<Kind, { endpoint: string; base: string; hint: string }> = {
  land: { endpoint: '/lands', base: '/lands', hint: tx('Land ID, দাগ, খতিয়ান বা মালিকের নাম লিখে খুঁজুন') },
  loan: { endpoint: '/loans', base: '/loans', hint: tx('ঋণ নং, সদস্য নং বা নাম লিখে খুঁজুন') },
}

/** Menu entry for a single-record screen (Land Profile, Loan Schedule …): find the record, then open it on the right tab. */
export default function RecordLookupPage({ kind, title, tab }: { kind: Kind; title: string; tab?: string }) {
  const navigate = useNavigate()
  const cfg = CFG[kind]
  const [search, setSearch] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['lookup', kind, search],
    enabled: search.trim() !== '',
    queryFn: async () => (await api.get<Paginated<LandHit | LoanHit>>(cfg.endpoint, { params: { search, per_page: 20 } })).data,
  })
  const open = (id: number) => navigate(`${cfg.base}/${id}${tab ? `?tab=${tab}` : ''}`)

  return (
    <>
      <div className="page-header">
        <h2>{title}</h2>
      </div>
      <Card>
        <Input.Search placeholder={cfg.hint} allowClear enterButton={tx('খুঁজুন')} size="large" style={{ maxWidth: 520, marginBottom: 16 }} onSearch={setSearch} autoFocus />
        {search.trim() !== '' && (
          <Table<LandHit | LoanHit>
            rowKey="id"
            size="small"
            loading={isFetching}
            dataSource={data?.data}
            pagination={false}
            onRow={(r) => ({ onClick: () => open(r.id), style: { cursor: 'pointer' } })}
            columns={
              kind === 'land'
                ? [
                    { title: 'Land ID', render: (_, r) => (r as LandHit).land_code },
                    { title: tx('মৌজা'), render: (_, r) => (r as LandHit).mouza },
                    { title: tx('খতিয়ান'), render: (_, r) => digits((r as LandHit).khatian_no) },
                    { title: tx('দাগ'), render: (_, r) => digits((r as LandHit).dag_no) },
                    { title: tx('মালিক'), render: (_, r) => (r as LandHit).owners.map((o) => o.name_bn).join(', ') },
                  ]
                : [
                    { title: tx('ঋণ নং'), render: (_, r) => digits((r as LoanHit).loan_no) },
                    { title: tx('সদস্য নং'), render: (_, r) => digits((r as LoanHit).member?.member_no) },
                    { title: tx('নাম'), render: (_, r) => nameOf((r as LoanHit).member?.farmer) },
                    { title: tx('ঋণের পরিমাণ'), align: 'right', render: (_, r) => money((r as LoanHit).amount) },
                  ]
            }
          />
        )}
      </Card>
    </>
  )
}
