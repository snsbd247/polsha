import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import RelatedLinks from '../../components/RelatedLinks'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { HISTORY_TITLE, TXN_STATUS_COLOR, toOptions, useFundMeta, type FundKind, type FundTxn } from '../../lib/funds'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Resp = Paginated<FundTxn> & { total_in: number; total_out: number }
type Params = { page: number; per_page: number; search?: string; type?: string; status?: string; method?: string; direction?: string; from?: string; to?: string }

export default function FundTxnListPage({ kind }: { kind: FundKind }) {
  const { message } = App.useApp()
  const meta = useFundMeta(kind)
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['fund-txns', kind, params],
    queryFn: async () => (await api.get<Resp>(`/funds/${kind}/transactions`, { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{HISTORY_TITLE[kind]}</h2>
        <Space wrap>
          <RelatedLinks links={[{ to: `/funds/${kind}/accounts`, label: kind === 'share' ? tx('শেয়ার মূলধন বিবরণী') : tx('সঞ্চয় হিসাব') }, { to: `/funds/${kind}/audit`, label: kind === 'share' ? tx('শেয়ার মূলধন মিলকরণ') : tx('সঞ্চয় অডিট') }]} />
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport(`/funds/${kind}/transactions`, { ...params, page: undefined, export: 'csv' }, `${kind}-transactions.csv`).catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('লেনদেন নং, হিসাব নং, নাম বা রেফারেন্স')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 170 }} options={toOptions(meta.data?.types)} onChange={(type) => set({ type })} />
        <Select placeholder={tx('দিক')} allowClear style={{ width: 120 }} options={toOptions(meta.data?.directions)} onChange={(direction) => set({ direction })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 170 }} options={toOptions(meta.data?.statuses)} onChange={(status) => set({ status })} />
        <Select placeholder={tx('মাধ্যম')} allowClear style={{ width: 150 }} options={toOptions(meta.data?.methods)} onChange={(method) => set({ method })} />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
      </div>
      <Table<FundTxn>
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
          showTotal: (t) => tx('মোট {{p0}}টি লেনদেন; জমা ৳{{p1}}, খরচ ৳{{p2}}', { p0: digits(t), p1: money(data?.total_in), p2: money(data?.total_out) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('লেনদেন নং'), dataIndex: 'txn_no', width: 150, render: (v: string, r) => <Link to={`/funds/${kind}/transactions/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          {
            title: tx('হিসাব নং'),
            width: 130,
            render: (_, r) => (r.account ? <Link to={`/funds/${kind}/accounts/${r.account.id}`}>{digits(r.account.account_no)}</Link> : ''),
          },
          { title: tx('নাম'), render: (_, r) => nameOf(r.account?.member?.farmer) },
          { title: tx('ধরন'), dataIndex: 'type', width: 150, render: (v: string) => meta.data?.types[v] ?? v },
          { title: tx('জমা'), width: 120, align: 'right', render: (_, r) => (r.direction === 'in' ? money(r.amount) : '') },
          { title: tx('খরচ'), width: 120, align: 'right', render: (_, r) => (r.direction === 'out' ? money(r.amount) : '') },
          { title: tx('জের'), dataIndex: 'balance_after', width: 120, align: 'right', render: (v) => (v === null ? '' : money(v)) },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 150, render: (s: string) => <Tag color={TXN_STATUS_COLOR[s]}>{meta.data?.statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}
