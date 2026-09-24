import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Row = {
  id: number
  receipt_no: string
  date: string
  payer_name: string
  method: string
  reference: string | null
  is_legacy: boolean
  legacy_no: string | null
  amount: string
  status: string
  farmer: { id: number; farmer_code: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Params = { page: number; per_page: number; search?: string; status?: string; method?: string; is_legacy?: string; from?: string; to?: string }

export default function ReceiptListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['receipts', params],
    queryFn: async () => (await api.get<Paginated<Row> & { total_amount: number }>('/receipts', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('টাকার রশিদ')}</h2>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/receipts', { ...params, page: undefined, export: 'csv' }, 'receipts.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          <Can perm="payment.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/collect')}>
              {tx('টাকা আদায়')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('রশিদ নং, নাম বা রেফারেন্স')} allowClear style={{ width: 240 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 170 }} options={Object.entries(RECEIPT_STATUS_LABEL).map(([value, label]) => ({ value, label }))} onChange={(status) => set({ status })} />
        <Select placeholder={tx('মাধ্যম')} allowClear style={{ width: 150 }} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} onChange={(method) => set({ method })} />
        <Select
          placeholder={tx('রশিদের ধরন')}
          allowClear
          style={{ width: 170 }}
          options={[
            { value: '0', label: tx('সফটওয়্যারের রশিদ') },
            { value: '1', label: tx('পুরনো (হাতে লেখা) রশিদ') },
          ]}
          onChange={(is_legacy) => set({ is_legacy })}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
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
          { title: tx('রশিদ নং'), dataIndex: 'receipt_no', width: 150, render: (v: string, r) => <Link to={`/payments/receipts/${r.id}`}>{digits(v)}</Link> },
          { title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', width: 130, render: (v) => (v ? digits(v) : '') },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          {
            title: tx('প্রদানকারী'),
            render: (_, r) => (r.farmer ? <Link to={`/farmers/${r.farmer.id}`}>{r.payer_name}</Link> : r.payer_name),
          },
          { title: tx('মাধ্যম'), dataIndex: 'method', width: 120, render: (v: string) => METHOD_LABEL[v] ?? v },
          { title: tx('রেফারেন্স'), dataIndex: 'reference', width: 140, render: (v) => (v ? digits(v) : '') },
          { title: tx('টাকা'), dataIndex: 'amount', width: 130, align: 'right', render: money },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 150, render: (s: string) => <Tag color={RECEIPT_STATUS_COLOR[s]}>{RECEIPT_STATUS_LABEL[s] ?? s}</Tag> },
          { title: tx('গ্রহণকারী'), width: 140, render: (_, r) => nameOf(r.creator) },
        ]}
      />
    </>
  )
}
