import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Col, Input, InputNumber, Row, Select, Statistic, Table, Tag } from 'antd'
import { DollarOutlined, DownloadOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { CONNECTION_STATUS_TONE, useWaterMeta, type WaterConnection } from '../../lib/water'
import PageFrame from '../../components/PageFrame'

type Row = WaterConnection & { open_bills: number; oldest_bill: string | null }
type Totals = { connections: number; due: number; bills: number }
type Params = { page: number; per_page: number; search?: string; type_id?: number; village_id?: number; status?: string; min_bills?: number }

/** Who owes what, connection by connection — biggest first; "N bills or more" finds the ones to disconnect. */
export default function DuesPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'due-list', params],
    queryFn: async () => (await api.get<Paginated<Row> & { totals: Totals }>('/water/dues', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির বিল বকেয়া') }]}
      title={tx('পানির বিল বকেয়া')}
      actions={
        <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/water/dues', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'water-dues.csv').catch((e) => message.error(errorMessage(e)))}>
          Excel
        </Button>
      }
    >
      <div className="toolbar">
        <Input.Search placeholder={tx('নাম, মোবাইল বা সংযোগ নং')} allowClear style={{ width: 230 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 150 }} options={meta?.types.map((x) => ({ value: x.id, label: nameOf(x) }))} onChange={(type_id) => set({ type_id })} />
        <Select placeholder={tx('গ্রাম')} allowClear style={{ width: 160 }} showSearch={{ optionFilterProp: 'label' }} options={villages.data?.map((v) => ({ value: v.id, label: nameOf(v) }))} onChange={(village_id) => set({ village_id })} />
        <Select placeholder={tx('সংযোগের অবস্থা')} allowClear style={{ width: 150 }} options={Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))} onChange={(status) => set({ status })} />
        <InputNumber min={1} placeholder={tx('কমপক্ষে কয়টি বিল বাকি')} style={{ width: 190 }} onChange={(v) => set({ min_bills: v ? Number(v) : undefined })} />
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={tx('বকেয়াদার সংযোগ')} value={digits(data?.totals.connections ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={tx('বকেয়া বিল')} value={digits(data?.totals.bills ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('মোট বকেয়া')} value={money(data?.totals.due)} prefix="৳" styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
      </Row>
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
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 120, render: (v: string, r) => <Link to={`/water/connections/${r.id}`}>{digits(v)}</Link> },
          { title: tx('গ্রাহক'), render: (_, r) => <Link to={`/water/connections/${r.id}`}>{nameOf(r)}</Link> },
          { title: tx('মোবাইল'), dataIndex: 'mobile', width: 125, render: (v) => (v ? digits(v) : '') },
          { title: tx('গ্রাম'), width: 130, render: (_, r) => nameOf(r.village) },
          { title: tx('ধরন'), width: 110, render: (_, r) => nameOf(r.type) },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 100, render: (s: string) => <Tag className={`fl-tag ${CONNECTION_STATUS_TONE[s] ?? ''}`}>{meta?.statuses[s] ?? s}</Tag> },
          { title: tx('বকেয়া বিল'), dataIndex: 'open_bills', width: 100, align: 'right', render: (v: number) => digits(v) },
          { title: tx('সবচেয়ে পুরনো'), dataIndex: 'oldest_bill', width: 115, render: fmtDate },
          { title: tx('বকেয়া'), dataIndex: 'due', width: 115, align: 'right', render: (v) => <strong style={{ color: '#cf1322' }}>{money(v)}</strong> },
          {
            title: '',
            width: 95,
            render: (_, r) =>
              can('water.create') ? (
                <Button size="small" icon={<DollarOutlined />} onClick={() => navigate(`/water/collect?connection=${r.id}`)}>
                  {tx('আদায়')}
                </Button>
              ) : null,
          },
        ]}
      />
    </PageFrame>
  )
}
