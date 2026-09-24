import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { JOURNAL_STATUS, VOUCHER_TYPE_LABEL, accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Row = {
  id: number
  voucher_no: string
  voucher_type: string
  date: string
  narration: string | null
  module: string | null
  status: string
  amount: number
  creator: { id: number; name_bn: string; name_en: string | null } | null
}

type Params = { page: number; per_page: number; search?: string; type?: string; status?: string; account_id?: number; from?: string; to?: string }

export default function JournalListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: accounts } = useAccountOptions()

  const { data, isFetching } = useQuery({
    queryKey: ['journals', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/journals', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('ভাউচার')}</h2>
        <Space wrap>
          <Can perm="accounting.export">
            <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/journals', { ...params, page: undefined, export: 'csv' }, 'vouchers.csv').catch((e) => message.error(errorMessage(e)))}>
              Excel
            </Button>
          </Can>
          <Can perm="accounting.create">
            <Button onClick={() => navigate('/accounting/journals/new?type=opening')}>{tx('প্রারম্ভিক জের এন্ট্রি')}</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounting/journals/new')}>
              {tx('নতুন জার্নাল')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('ভাউচার নং বা বিবরণ')} allowClear style={{ width: 220 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 150 }} options={Object.entries(VOUCHER_TYPE_LABEL).map(([value, label]) => ({ value, label }))} onChange={(type) => set({ type })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 170 }} options={Object.entries(JOURNAL_STATUS).map(([value, s]) => ({ value, label: s.label }))} onChange={(status) => set({ status })} />
        <Select
          placeholder={tx('হিসাব')}
          allowClear
          style={{ width: 240 }}
          showSearch={{ filterOption: accountFilter }}
          options={accounts?.map((a) => ({ value: a.id, label: accountLabel(a) }))}
          onChange={(account_id) => set({ account_id })}
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
        scroll={{ x: 900 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি', { p0: digits(t) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', width: 150, render: (v: string, j) => <Link to={`/accounting/journals/${j.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          { title: tx('ধরন'), dataIndex: 'voucher_type', width: 130, render: (t: string) => VOUCHER_TYPE_LABEL[t] ?? t },
          { title: tx('বিবরণ'), dataIndex: 'narration', ellipsis: true },
          { title: tx('পরিমাণ (টাকা)'), dataIndex: 'amount', width: 140, align: 'right', render: money },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 160, render: (s: string) => <Tag color={JOURNAL_STATUS[s]?.color}>{JOURNAL_STATUS[s]?.label ?? s}</Tag> },
          { title: tx('প্রস্তুতকারী'), width: 140, render: (_, j) => nameOf(j.creator) },
        ]}
      />
    </>
  )
}
