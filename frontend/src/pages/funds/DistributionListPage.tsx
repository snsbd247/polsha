import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Select, Space, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RUN_STATUS_COLOR, toOptions, type Person } from '../../lib/funds'
import { nameOf, t as tx } from '../../lib/i18n'

export type RunRow = {
  id: number
  run_no: string
  kind: 'profit' | 'dividend'
  title: string
  date: string
  basis_date: string | null
  pool_amount: string | null
  total_amount: string
  status: string
  remarks: string | null
  items_count?: number
  approval_request_id: number | null
  creator: Person
}
type Resp = Paginated<RunRow> & { kinds: Record<string, string>; statuses: Record<string, string> }
type Params = { page: number; per_page: number; kind?: string; status?: string }

export default function DistributionListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data, isFetching } = useQuery({
    queryKey: ['distributions', params],
    queryFn: async () => (await api.get<Resp>('/distributions', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('মুনাফা ও লভ্যাংশ বণ্টন')}</h2>
        <Space wrap>
          <Can perm="savings.edit">
            <Button icon={<PlusOutlined />} onClick={() => navigate('/funds/distributions/new/profit')}>
              {tx('সঞ্চয়ের মুনাফা')}
            </Button>
          </Can>
          <Can perm="share.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/funds/distributions/new/dividend')}>
              {tx('শেয়ারের লভ্যাংশ')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 180 }} options={toOptions(data?.kinds)} onChange={(kind) => set({ kind })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 180 }} options={toOptions(data?.statuses)} onChange={(status) => set({ status })} />
      </div>
      <Table<RunRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('বণ্টন নং'), dataIndex: 'run_no', width: 140, render: (v: string, r) => <Link to={`/funds/distributions/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          { title: tx('ধরন'), dataIndex: 'kind', width: 160, render: (v: string) => data?.kinds[v] ?? v },
          { title: tx('শিরোনাম'), dataIndex: 'title' },
          { title: tx('সদস্য সংখ্যা'), dataIndex: 'items_count', width: 110, align: 'right', render: (v: number) => digits(v) },
          { title: tx('মোট'), dataIndex: 'total_amount', width: 130, align: 'right', render: money },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 150, render: (s: string) => <Tag color={RUN_STATUS_COLOR[s]}>{data?.statuses[s] ?? s}</Tag> },
          { title: tx('তৈরি করেছেন'), width: 140, render: (_, r) => nameOf(r.creator) },
        ]}
      />
    </>
  )
}
