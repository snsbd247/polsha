import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { COMBINED_STATUS_COLOR, type CombinedModule } from '../../lib/phase8'
import { downloadExport, toOptions } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Row = {
  id: number
  payment_no: string
  date: string
  payer_name: string
  method: string
  amount: string
  status: string
  parts: { id: number; module: CombinedModule; amount: string }[]
  farmer: { id: number; farmer_code: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Resp = Paginated<Row> & { total_amount: number; methods: Record<string, string>; statuses: Record<string, string>; modules: Record<string, string> }
type Params = { page: number; per_page: number; search?: string; status?: string; method?: string; from?: string; to?: string }

export default function CombinedPaymentListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data, isFetching } = useQuery({
    queryKey: ['combined-payments', params],
    queryFn: async () => (await api.get<Resp>('/combined-payments', { params })).data,
    placeholderData: keepPreviousData,
  })
  const part = (r: Row, m: CombinedModule) => moneyOrBlank(Number(r.parts.find((p) => p.module === m)?.amount ?? 0))

  return (
    <>
      <div className="page-header">
        <h2>{tx('সমন্বিত রশিদ')}</h2>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/combined-payments', { ...params, page: undefined, export: 'csv' }, 'combined-receipts.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          <Can perm="payment.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/combined/new')}>
              {tx('সমন্বিত আদায়')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('রশিদ নং, নাম বা রেফারেন্স')} allowClear style={{ width: 240 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 170 }} options={toOptions(data?.statuses)} onChange={(status) => set({ status })} />
        <Select placeholder={tx('মাধ্যম')} allowClear style={{ width: 150 }} options={toOptions(data?.methods)} onChange={(method) => set({ method })} />
        <DatePicker.RangePicker format="DD/MM/YYYY" onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })} />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1150 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি রশিদ, ৳{{p1}} (বাতিল ছাড়া)', { p0: digits(t), p1: money(data?.total_amount) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('রশিদ নং'), dataIndex: 'payment_no', width: 150, render: (v: string, r) => <Link to={`/payments/combined/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          { title: tx('প্রদানকারী'), render: (_, r) => (r.farmer ? <Link to={`/farmers/${r.farmer.id}`}>{r.payer_name}</Link> : r.payer_name) },
          { title: tx('মাধ্যম'), dataIndex: 'method', width: 110, render: (v: string) => data?.methods[v] ?? v },
          { title: data?.modules.loan ?? tx('ঋণ'), width: 100, align: 'right', render: (_, r) => part(r, 'loan') },
          { title: data?.modules.irrigation ?? tx('সেচ'), width: 100, align: 'right', render: (_, r) => part(r, 'irrigation') },
          { title: data?.modules.share ?? tx('শেয়ার'), width: 100, align: 'right', render: (_, r) => part(r, 'share') },
          { title: data?.modules.savings ?? tx('সঞ্চয়'), width: 100, align: 'right', render: (_, r) => part(r, 'savings') },
          { title: tx('মোট'), dataIndex: 'amount', width: 120, align: 'right', render: (v) => <strong>{money(v)}</strong> },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 140, render: (s: string) => <Tag color={COMBINED_STATUS_COLOR[s]}>{data?.statuses[s] ?? s}</Tag> },
          { title: tx('গ্রহণকারী'), width: 130, render: (_, r) => nameOf(r.creator) },
        ]}
      />
    </>
  )
}
