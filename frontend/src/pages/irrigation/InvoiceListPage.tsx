import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Checkbox, Col, DatePicker, Input, Row, Select, Space, Statistic, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import RelatedLinks from '../../components/RelatedLinks'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { INVOICE_STATUS_COLOR, useInvoiceMeta, type InvoiceRow } from '../../lib/irrigation'
import { CULTIVATION_COLOR } from '../../lib/land'
import { downloadExport, toOptions } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'

type Params = {
  page: number
  per_page: number
  search?: string
  season_id?: number
  status?: string
  irrigation_type_id?: number
  cultivation_type?: string
  mouza_id?: number
  farmer_id?: number
  batch_id?: number
  due?: 1
  overdue?: 1
  from?: string
  to?: string
}
type Totals = { amount: number; paid: number; due: number }

const num = (v: string | null) => (v ? Number(v) : undefined)

export default function InvoiceListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [search] = useSearchParams()
  const [params, setParams] = useState<Params>(() => ({
    page: 1,
    per_page: 25,
    season_id: num(search.get('season_id')),
    farmer_id: num(search.get('farmer_id')),
    batch_id: num(search.get('batch_id')),
  }))
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: meta } = useInvoiceMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const { data, isFetching } = useQuery({
    queryKey: ['invoices', params],
    queryFn: async () => (await api.get<Paginated<InvoiceRow> & { totals: Totals }>('/invoices', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('সেচ ইনভয়েস')}</h2>
        <Space wrap>
          <RelatedLinks links={[{ to: '/irrigation/dues', label: tx('বকেয়া তালিকা') }]} />
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/invoices', { ...params, page: undefined, export: 'csv' }, 'irrigation-invoices.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          <Can perm="irrigation.create">
            <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/irrigation/invoices/bulk')}>
              {tx('একসাথে ইনভয়েস')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/irrigation/invoices/new')}>
              {tx('নতুন ইনভয়েস')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('ইনভয়েস নং, নাম, দাগ বা Land ID')} allowClear style={{ width: 240 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('মৌসুম')} allowClear style={{ width: 170 }} value={params.season_id} options={meta?.seasons.map((s) => ({ value: s.id, label: s.name_bn }))} onChange={(season_id) => set({ season_id })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 160 }} options={toOptions(meta?.statuses)} onChange={(status) => set({ status })} />
        <Select placeholder={tx('সেচের ধরন')} allowClear style={{ width: 170 }} options={meta?.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} onChange={(irrigation_type_id) => set({ irrigation_type_id })} />
        <Select placeholder={tx('চাষের ধরন')} allowClear style={{ width: 140 }} options={toOptions(meta?.cultivation_types)} onChange={(cultivation_type) => set({ cultivation_type })} />
        <Select
          placeholder={tx('মৌজা')}
          allowClear
          style={{ width: 170 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))}
          onChange={(mouza_id) => set({ mouza_id })}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
        <Checkbox onChange={(e) => set({ due: e.target.checked ? 1 : undefined })}>{tx('শুধু বকেয়া')}</Checkbox>
        <Checkbox onChange={(e) => set({ overdue: e.target.checked ? 1 : undefined })}>{tx('মেয়াদোত্তীর্ণ')}</Checkbox>
        {(params.farmer_id || params.batch_id) && (
          <Button size="small" onClick={() => set({ farmer_id: undefined, batch_id: undefined })}>
            {params.batch_id ? tx('ব্যাচ #{{p0}} — ফিল্টার সরান', { p0: digits(params.batch_id) }) : tx('কৃষক ফিল্টার সরান')}
          </Button>
        )}
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('মোট বিল')} value={money(data?.totals.amount)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('আদায়')} value={money(data?.totals.paid)} prefix="৳" styles={{ content: { color: '#389e0d' } }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('বকেয়া')} value={money(data?.totals.due)} prefix="৳" styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
      </Row>
      <Table<InvoiceRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1300 }}
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
          { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', width: 150, fixed: 'left', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'invoice_date', width: 105, render: fmtDate },
          { title: tx('মৌসুম'), dataIndex: 'season', width: 120 },
          {
            title: tx('চাষি'),
            render: (_, r) =>
              r.cultivator && (
                <Link to={`/farmers/${r.cultivator.id}`}>
                  {nameOf(r.cultivator)} <small style={{ color: '#888' }}>({digits(r.cultivator.farmer_code)})</small>
                </Link>
              ),
          },
          { title: tx('চাষ'), dataIndex: 'cultivation_type', width: 90, render: (v: string) => <Tag color={CULTIVATION_COLOR[v]}>{meta?.cultivation_types[v] ?? v}</Tag> },
          { title: tx('মৌজা / দাগ'), width: 150, render: (_, r) => `${nameOf({ name_bn: r.mouza, name_en: r.mouza_en })} / ${digits(r.dag_no)}` },
          { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type', width: 130 },
          { title: tx('শতক'), dataIndex: 'area_decimal', width: 80, align: 'right', render: (v) => digits(Number(v)) },
          { title: tx('রেট'), dataIndex: 'rate', width: 80, align: 'right', render: (v) => digits(Number(v)) },
          { title: tx('বিল'), dataIndex: 'amount', width: 110, align: 'right', render: money },
          { title: tx('আদায়'), dataIndex: 'paid_amount', width: 110, align: 'right', render: money },
          { title: tx('বকেয়া'), dataIndex: 'due', width: 110, align: 'right', render: (v: number) => <span style={{ color: v > 0 ? '#cf1322' : undefined }}>{money(v)}</span> },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 130, render: (s: string) => <Tag color={INVOICE_STATUS_COLOR[s]}>{meta?.statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}
