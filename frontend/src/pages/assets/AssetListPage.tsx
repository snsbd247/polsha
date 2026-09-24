import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, Col, Input, Row, Select, Statistic, Table, Tag } from 'antd'
import { AppstoreOutlined, CalculatorOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport, toOptions } from '../../lib/phase2'
import { ASSET_STATUS_COLOR, CONDITION_COLOR, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'

export type AssetRow = {
  id: number
  asset_code: string
  name_bn: string
  name_en: string | null
  category_id: number
  category?: { id: number; code: string; name_bn: string; name_en: string | null } | null
  mouza?: { id: number; name_bn: string; name_en: string | null } | null
  brand_model: string | null
  serial_no: string | null
  purchase_date: string
  cost: string
  salvage_value: string
  life_months: number
  accumulated_depreciation: string
  book_value: number
  acquisition: string
  location: string | null
  custodian: string | null
  condition: string | null
  status: string
  installed_on: string | null
}
type Resp = Paginated<AssetRow> & { totals: { count: number; cost: number; accumulated: number; book_value: number } }
type Params = { page: number; per_page: number; status?: string; category_id?: number; condition?: string; acquisition?: string; search?: string }

type Preset = 'stock' | 'disposal'
const PRESET: Record<Preset, { title: string; status: string }> = {
  stock: { title: tx('স্টক (অস্থাপিত সম্পদ)'), status: 'in_stock' },
  disposal: { title: tx('সম্পদ বিক্রয় ও বাতিল'), status: 'disposal' },
}

/** Asset register; the Stock and Sales menu items are this list with a fixed status. */
export default function AssetListPage({ preset }: { preset?: Preset }) {
  const navigate = useNavigate()
  const meta = useAssetMeta()
  const fixed = preset ? PRESET[preset] : null
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25, status: fixed?.status ?? 'active' })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const q = { ...params, status: fixed?.status ?? params.status }
  const { data, isFetching } = useQuery({
    queryKey: ['assets', q],
    queryFn: async () => (await api.get<Resp>('/assets', { params: q })).data,
    placeholderData: keepPreviousData,
  })
  const statusOptions = [{ value: 'active', label: tx('চালু সব সম্পদ') }, { value: 'disposal', label: tx('বিক্রয়/বাতিল সংক্রান্ত') }, ...toOptions(meta.data?.statuses)]

  return (
    <>
      <div className="page-header">
        <h2>{fixed?.title ?? tx('সম্পদ রেজিস্টার')}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/assets/categories">
            <Button icon={<AppstoreOutlined />}>{tx('সম্পদের শ্রেণি')}</Button>
          </Link>
          <Link to="/assets/depreciation">
            <Button icon={<CalculatorOutlined />}>{tx('অবচয়')}</Button>
          </Link>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/assets', { ...q, export: 'csv' }, 'asset-register.csv')}>
            {tx('CSV')}
          </Button>
          <Can perm="asset.create">
            <Link to="/assets/new">
              <Button type="primary" icon={<PlusOutlined />}>
                {tx('নতুন সম্পদ')}
              </Button>
            </Link>
          </Can>
        </div>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('সম্পদ সংখ্যা')} value={digits(data?.totals.count ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('ক্রয়মূল্য')} value={money(data?.totals.cost ?? 0)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('পুঞ্জীভূত অবচয়')} value={money(data?.totals.accumulated ?? 0)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বর্তমান মূল্য')} value={money(data?.totals.book_value ?? 0)} prefix="৳" styles={{ content: { color: '#1677ff' } }} />
          </Card>
        </Col>
      </Row>
      <div className="toolbar">
        <Input.Search placeholder={tx('কোড, নাম, সিরিয়াল, অবস্থান')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        {!fixed && <Select value={params.status} style={{ width: 200 }} options={statusOptions} onChange={(status) => set({ status })} allowClear placeholder={tx('স্ট্যাটাস')} />}
        <Select
          placeholder={tx('শ্রেণি')}
          allowClear
          style={{ width: 180 }}
          options={(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: nameOf(c) }))}
          onChange={(category_id) => set({ category_id })}
        />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 130 }} options={toOptions(meta.data?.conditions)} onChange={(condition) => set({ condition })} />
        <Select placeholder={tx('অর্জনের ধরন')} allowClear style={{ width: 180 }} options={toOptions(meta.data?.acquisitions)} onChange={(acquisition) => set({ acquisition })} />
      </div>
      <Table<AssetRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
        onRow={(r) => ({ onClick: () => navigate(`/assets/${r.id}`), style: { cursor: 'pointer' } })}
        pagination={{ current: params.page, pageSize: params.per_page, total: data?.total, onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })) }}
        columns={[
          { title: tx('কোড'), dataIndex: 'asset_code', width: 110, render: (v: string) => digits(v) },
          { title: tx('নাম'), render: (_, r) => nameOf(r) },
          { title: tx('শ্রেণি'), render: (_, r) => nameOf(r.category) },
          { title: tx('ক্রয়ের তারিখ'), dataIndex: 'purchase_date', width: 110, render: fmtDate },
          { title: tx('ক্রয়মূল্য'), dataIndex: 'cost', align: 'right', render: money },
          { title: tx('বর্তমান মূল্য'), dataIndex: 'book_value', align: 'right', render: money },
          { title: tx('অবস্থান'), render: (_, r) => r.location ?? nameOf(r.mouza) },
          { title: tx('ভৌত অবস্থা'), dataIndex: 'condition', width: 90, render: (v: string | null) => (v ? <Tag color={CONDITION_COLOR[v]}>{meta.data?.conditions[v] ?? v}</Tag> : null) },
          { title: tx('স্ট্যাটাস'), dataIndex: 'status', width: 150, render: (v: string) => <Tag color={ASSET_STATUS_COLOR[v]}>{meta.data?.statuses[v] ?? v}</Tag> },
        ]}
      />
    </>
  )
}
