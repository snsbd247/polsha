import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Col, Input, Row, Select, Statistic, Table, Tag } from 'antd'
import { DollarOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { CONNECTION_STATUS_TONE, feeOf, useWaterMeta, type WaterConnection } from '../../lib/water'
import PageFrame from '../../components/PageFrame'
import ConnectionForm from './ConnectionForm'

type Params = { page: number; per_page: number; search?: string; type_id?: number; village_id?: number; status?: string }
type Summary = { total: number; active: number; disconnected: number; new_this_month: number; due: number }

export default function ConnectionsPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const [adding, setAdding] = useState(false)
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const summary = useQuery({ queryKey: ['water', 'connections-summary'], queryFn: async () => (await api.get<Summary>('/water/connections-summary')).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'connections', params],
    queryFn: async () => (await api.get<Paginated<WaterConnection>>('/water/connections', { params })).data,
    placeholderData: keepPreviousData,
  })

  const cards = [
    { title: tx('মোট সংযোগ'), value: digits(summary.data?.total ?? 0) },
    { title: tx('চালু সংযোগ'), value: digits(summary.data?.active ?? 0), color: '#389e0d' },
    { title: tx('বিচ্ছিন্ন'), value: digits(summary.data?.disconnected ?? 0), color: '#cf1322' },
    { title: tx('এই মাসে নতুন'), value: digits(summary.data?.new_this_month ?? 0) },
    { title: tx('মোট বকেয়া'), value: `৳ ${money(summary.data?.due)}`, color: '#cf1322' },
  ]

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('সংযোগ ও গ্রাহক') }]}
      title={tx('সংযোগ ও গ্রাহক')}
      subtitle={tx('প্রতিটি সংযোগ একটি গ্রাহক হিসাব — ধরন অনুযায়ী নির্দিষ্ট মাসিক বিল।')}
      actions={
        <>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/water/connections', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'water-connections.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          {can('water.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              {tx('নতুন সংযোগ')}
            </Button>
          )}
        </>
      }
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {cards.map((c) => (
          <Col xs={12} md={8} lg={4} flex="1" key={c.title}>
            <Card size="small">
              <Statistic title={c.title} value={c.value} styles={c.color ? { content: { color: c.color } } : undefined} />
            </Card>
          </Col>
        ))}
      </Row>
      <div className="toolbar">
        <Input.Search placeholder={tx('নাম, মোবাইল বা সংযোগ নং')} allowClear style={{ width: 240 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 160 }} options={meta?.types.map((t) => ({ value: t.id, label: nameOf(t) }))} onChange={(type_id) => set({ type_id })} />
        <Select placeholder={tx('গ্রাম')} allowClear style={{ width: 170 }} showSearch={{ optionFilterProp: 'label' }} options={villages.data?.map((v) => ({ value: v.id, label: nameOf(v) }))} onChange={(village_id) => set({ village_id })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 140 }} options={Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))} onChange={(status) => set({ status })} />
      </div>
      <Table<WaterConnection>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
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
          { title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 120, render: (v: string, r) => <Link to={`/water/connections/${r.id}`}>{digits(v)}</Link> },
          {
            title: tx('গ্রাহক'),
            render: (_, r) => (
              <>
                <Link to={`/water/connections/${r.id}`}>{nameOf(r)}</Link>
                {r.father_name && <div style={{ color: '#888', fontSize: 12 }}>{r.father_name}</div>}
              </>
            ),
          },
          { title: tx('মোবাইল'), dataIndex: 'mobile', width: 125, render: (v) => (v ? digits(v) : '') },
          { title: tx('গ্রাম / পাড়া'), render: (_, r) => [nameOf(r.village), r.address].filter(Boolean).join(', ') },
          { title: tx('ধরন'), width: 120, render: (_, r) => nameOf(r.type) },
          { title: tx('মাসিক ফি'), width: 105, align: 'right', render: (_, r) => money(feeOf(r)) },
          { title: tx('সংযোগের তারিখ'), dataIndex: 'connected_on', width: 120, render: fmtDate },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 100, render: (s: string) => <Tag className={`fl-tag ${CONNECTION_STATUS_TONE[s] ?? ''}`}>{meta?.statuses[s] ?? s}</Tag> },
          { title: tx('বকেয়া'), dataIndex: 'due', width: 110, align: 'right', render: (v) => (Number(v) > 0 ? <strong style={{ color: '#cf1322' }}>{money(v)}</strong> : money(0)) },
          {
            title: '',
            width: 95,
            render: (_, r) =>
              can('water.create') && Number(r.due) > 0 ? (
                <Button size="small" icon={<DollarOutlined />} onClick={() => navigate(`/water/collect?connection=${r.id}`)}>
                  {tx('আদায়')}
                </Button>
              ) : null,
          },
        ]}
      />
      <ConnectionForm open={adding} onClose={() => setAdding(false)} onSaved={(c) => navigate(`/water/connections/${c.id}`)} />
    </PageFrame>
  )
}
