import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, Col, Drawer, Row, Select, Statistic, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { fmtArea, useLandMeta } from '../../lib/land'

type Check = { key: string; label: string; entity: 'land' | 'farmer' | 'mouza'; severity: 'error' | 'warning' | 'info'; count: number | null }
type MouzaRow = { id: number; name_bn: string; jl_no: string; union: string | null; upazila: string | null; is_active: boolean; villages_count: number; land_count: number; area_decimal: number; farmer_count: number; issue_count: number }
type Item = { id: number; code: string; link: string; title: string; detail: string; mouza: string | null }

const SEVERITY = { error: { color: '#cf1322', label: 'গুরুতর' }, warning: { color: '#d48806', label: 'সতর্কতা' }, info: { color: '#1677ff', label: 'তথ্য' } }
const ENTITY = { land: 'জমি', farmer: 'কৃষক', mouza: 'মৌজা' }

export default function DataHealthPage() {
  const navigate = useNavigate()
  const { data: meta } = useLandMeta()
  const [mouzaId, setMouzaId] = useState<number>()
  const [open, setOpen] = useState<Check | null>(null)
  const [page, setPage] = useState(1)

  const summary = useQuery({
    queryKey: ['data-health', 'summary', mouzaId],
    queryFn: async () => (await api.get<Check[]>('/data-health/summary', { params: { mouza_id: mouzaId } })).data,
  })
  const mouzas = useQuery({ queryKey: ['data-health', 'mouzas'], queryFn: async () => (await api.get<MouzaRow[]>('/data-health/mouzas')).data })
  const items = useQuery({
    queryKey: ['data-health', 'items', open?.key, mouzaId, page],
    queryFn: async () => (await api.get<Paginated<Item>>(`/data-health/items/${open!.key}`, { params: { mouza_id: mouzaId, page } })).data,
    enabled: !!open && open.key !== 'farmer_duplicate',
    placeholderData: keepPreviousData,
  })

  const checks = summary.data ?? []
  const problems = checks.reduce((s, c) => s + (c.severity !== 'info' ? c.count ?? 0 : 0), 0)
  const totals = (mouzas.data ?? []).reduce((t, m) => ({ lands: t.lands + m.land_count, area: t.area + m.area_decimal, farmers: t.farmers + m.farmer_count }), { lands: 0, area: 0, farmers: 0 })

  const openCheck = (c: Check) => {
    if (c.key === 'farmer_duplicate') return navigate('/farmers/duplicates')
    setPage(1)
    setOpen(c)
  }

  return (
    <>
      <div className="page-header">
        <h2>Data Health</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            placeholder="সব মৌজা"
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            style={{ width: 200 }}
            value={mouzaId}
            onChange={setMouzaId}
            options={mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => (summary.refetch(), mouzas.refetch())} aria-label="আবার যাচাই" />
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="মোট জমি" value={digits(totals.lands)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="মোট পরিমাণ" value={fmtArea(totals.area, meta)} styles={{ content: { fontSize: 18 } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="মোট কৃষক" value={digits(totals.farmers)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="সমাধান দরকার"
              value={digits(problems)}
              styles={{ content: { color: problems ? '#cf1322' : '#389e0d' } }}
              prefix={problems ? undefined : <CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="যাচাইয়ের ফলাফল" style={{ marginBottom: 16 }} loading={summary.isLoading}>
        <Row gutter={[12, 12]}>
          {checks.map((c) => (
            <Col xs={24} md={12} xl={8} key={c.key}>
              <Card size="small" hoverable={!!c.count} onClick={() => c.count && openCheck(c)} style={{ borderLeft: `4px solid ${c.count ? SEVERITY[c.severity].color : '#52c41a'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div>{c.label}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {ENTITY[c.entity]} · {SEVERITY[c.severity].label}
                    </Typography.Text>
                  </div>
                  <strong style={{ fontSize: 22, color: c.count ? SEVERITY[c.severity].color : '#52c41a' }}>{c.count === null ? '—' : digits(c.count)}</strong>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="মৌজাভিত্তিক হিসাব" styles={{ body: { padding: 0 } }}>
        <Table<MouzaRow>
          rowKey="id"
          size="small"
          loading={mouzas.isLoading}
          dataSource={mouzas.data}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          columns={[
            { title: 'মৌজা', render: (_, m) => <>{m.name_bn} {!m.is_active && <Tag>নিষ্ক্রিয়</Tag>}</> },
            { title: 'JL', dataIndex: 'jl_no', render: digits },
            { title: 'ইউনিয়ন', dataIndex: 'union' },
            { title: 'গ্রাম', dataIndex: 'villages_count', render: digits },
            { title: 'জমি', dataIndex: 'land_count', render: (v, m) => <Link to={`/lands?mouza_id=${m.id}`}>{digits(v)}</Link>, sorter: (a, b) => a.land_count - b.land_count },
            { title: 'পরিমাণ', dataIndex: 'area_decimal', render: (v) => fmtArea(v, meta), sorter: (a, b) => a.area_decimal - b.area_decimal },
            { title: 'কৃষক', dataIndex: 'farmer_count', render: digits, sorter: (a, b) => a.farmer_count - b.farmer_count },
            {
              title: 'সমস্যা',
              dataIndex: 'issue_count',
              defaultSortOrder: 'descend',
              sorter: (a, b) => a.issue_count - b.issue_count,
              render: (v, m) => (v ? <Button size="small" danger type="link" onClick={() => setMouzaId(m.id)}><Badge count={digits(v)} /></Button> : <CheckCircleOutlined style={{ color: '#52c41a' }} />),
            },
          ]}
        />
      </Card>

      <Drawer open={!!open} onClose={() => setOpen(null)} size={720} title={open?.label}>
        <Table<Item>
          rowKey="id"
          size="small"
          loading={items.isFetching}
          dataSource={items.data?.data}
          pagination={{ current: page, pageSize: items.data?.per_page, total: items.data?.total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'code', render: (v, i) => <Link to={i.link}>{v}</Link> },
            { title: 'বিবরণ', render: (_, i) => <><div>{i.title}</div><Typography.Text type="secondary">{i.detail}</Typography.Text></> },
            { title: 'মৌজা', dataIndex: 'mouza' },
          ]}
        />
      </Drawer>
    </>
  )
}
