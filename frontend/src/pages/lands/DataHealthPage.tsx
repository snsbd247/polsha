import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Drawer, Select, Table, Tag } from 'antd'
import { CheckCircleFilled, EnvironmentFilled, ReloadOutlined, SafetyCertificateFilled, TeamOutlined, WarningFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { api, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { fmtArea, useLandMeta } from '../../lib/land'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow, acres, n0 } from './ListFrame'
import './land-list.css'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import '../accounting/accounting.css'

type Check = { key: string; label: string; entity: 'land' | 'farmer' | 'mouza'; severity: 'error' | 'warning' | 'info'; count: number | null }
type MouzaRow = { id: number; name_bn: string; jl_no: string; union: string | null; upazila: string | null; is_active: boolean; villages_count: number; land_count: number; area_decimal: number; farmer_count: number; issue_count: number }
type Item = { id: number; code: string; link: string; title: string; detail: string; mouza: string | null }

const SEVERITY = { error: { color: '#e5383b', label: tx('গুরুতর') }, warning: { color: '#d48806', label: tx('সতর্কতা') }, info: { color: '#1769e0', label: tx('তথ্য') } }
const ENTITY = { land: tx('জমি'), farmer: tx('কৃষক'), mouza: tx('মৌজা') }

/** Mouza data health: missing or inconsistent land / farmer / mouza data, per mouza, with the records to fix. */
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
  const problems = checks.reduce((s, c) => s + (c.severity !== 'info' ? (c.count ?? 0) : 0), 0)
  const rows = (mouzas.data ?? []).filter((m) => !mouzaId || m.id === mouzaId)
  const totals = rows.reduce((t, m) => ({ lands: t.lands + m.land_count, area: t.area + m.area_decimal, farmers: t.farmers + m.farmer_count }), { lands: 0, area: 0, farmers: 0 })
  const ready = !!mouzas.data

  const openCheck = (c: Check) => {
    if (c.key === 'farmer_duplicate') return navigate('/farmers/duplicates')
    setPage(1)
    setOpen(c)
  }

  const cards = [
    { key: 'lands', label: tx('মোট জমি'), value: ready ? totals.lands : undefined, icon: '', glyph: <EnvironmentFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => navigate(mouzaId ? `/lands?mouza_id=${mouzaId}` : '/lands') },
    { key: 'area', label: tx('মোট পরিমাণ'), value: ready ? acres(totals.area) : undefined, unit: tx('একর'), icon: '', glyph: <SafetyCertificateFilled />, color: '#0e9f9a', tint: '#d9f4f2' },
    { key: 'farmers', label: tx('মোট কৃষক'), value: ready ? totals.farmers : undefined, icon: '', glyph: <TeamOutlined />, color: '#8b3fe0', tint: '#efe4fc' },
    {
      key: 'problems',
      label: tx('সমাধান দরকার'),
      value: summary.data ? problems : undefined,
      icon: '',
      glyph: problems ? <WarningFilled /> : <CheckCircleFilled />,
      color: problems ? '#e5383b' : '#1f9d55',
      tint: problems ? '#fde4e5' : '#dcf3e5',
    },
  ]

  return (
    <PageFrame
      className="ml pl id-page"
      crumbs={[{ label: tx('প্রশাসন'), to: '/admin/users' }, { label: tx('মৌজা ডেটা হেলথ') }]}
      title={tx('মৌজা ডেটা হেলথ')}
      actions={
        <span className="id-actions">
          <Select
            className="pm-switch"
            placeholder={tx('সব মৌজা')}
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            value={mouzaId}
            onChange={setMouzaId}
            options={mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${digits(m.jl_no)})` }))}
          />
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => (summary.refetch(), mouzas.refetch())}>
            {tx('আবার যাচাই')}
          </Button>
        </span>
      }
    >
      <StatRow cards={cards} className="li-cards" />

      <Box icon={<SafetyCertificateFilled />} title={tx('যাচাইয়ের ফলাফল')} className="li-box">
        <div className="dh-checks">
          {checks.map((c) => (
            <button key={c.key} type="button" disabled={!c.count} onClick={() => c.count && openCheck(c)} style={{ borderLeftColor: c.count ? SEVERITY[c.severity].color : '#1f9d55' }}>
              <span>
                <strong>{c.label}</strong>
                <small>
                  {ENTITY[c.entity]} · {SEVERITY[c.severity].label}
                </small>
              </span>
              <b style={{ color: c.count ? SEVERITY[c.severity].color : '#1f9d55' }}>{c.count === null ? '—' : digits(c.count)}</b>
            </button>
          ))}
          {summary.isLoading && <span className="ac-muted">{tx('যাচাই চলছে...')}</span>}
        </div>
      </Box>

      <Box icon={<EnvironmentFilled />} title={tx('মৌজাভিত্তিক হিসাব ({{p0}})', { p0: n0(rows.length) })}>
        <Table<MouzaRow>
          rowKey="id"
          size="small"
          className="id-payments"
          loading={mouzas.isLoading}
          dataSource={rows}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          columns={[
            {
              title: tx('মৌজা'),
              render: (_, m) => (
                <span className="coa-name">
                  <strong>{m.name_bn}</strong> {!m.is_active && <Tag className="fl-tag ll-gray">{tx('নিষ্ক্রিয়')}</Tag>}
                </span>
              ),
            },
            { title: 'JL', dataIndex: 'jl_no', render: digits },
            { title: tx('ইউনিয়ন'), dataIndex: 'union', render: (v: string | null) => v || '—' },
            { title: tx('গ্রাম'), dataIndex: 'villages_count', align: 'right', render: (v: number) => n0(v) },
            { title: tx('জমি'), dataIndex: 'land_count', align: 'right', render: (v, m) => <Link to={`/lands?mouza_id=${m.id}`}>{n0(v)}</Link>, sorter: (a, b) => a.land_count - b.land_count },
            { title: tx('পরিমাণ'), dataIndex: 'area_decimal', align: 'right', render: (v) => fmtArea(v, meta), sorter: (a, b) => a.area_decimal - b.area_decimal },
            { title: tx('কৃষক'), dataIndex: 'farmer_count', align: 'right', render: (v: number) => n0(v), sorter: (a, b) => a.farmer_count - b.farmer_count },
            {
              title: tx('সমস্যা'),
              dataIndex: 'issue_count',
              align: 'center',
              defaultSortOrder: 'descend',
              sorter: (a, b) => a.issue_count - b.issue_count,
              render: (v: number, m) =>
                v ? (
                  <Button size="small" className="fl-tag fl-tag-red" onClick={() => setMouzaId(m.id)}>
                    {digits(v)}
                  </Button>
                ) : (
                  <CheckCircleFilled style={{ color: '#1f9d55' }} />
                ),
            },
          ]}
        />
      </Box>

      <Drawer open={!!open} onClose={() => setOpen(null)} size={720} title={open?.label}>
        <Table<Item>
          rowKey="id"
          size="small"
          loading={items.isFetching}
          dataSource={items.data?.data}
          pagination={{ current: page, pageSize: items.data?.per_page, total: items.data?.total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'code', render: (v, i) => <Link to={i.link}>{digits(v)}</Link> },
            {
              title: tx('বিবরণ'),
              render: (_, i) => (
                <span className="hs-two">
                  <span>{i.title}</span>
                  <span className="ac-muted">{i.detail}</span>
                </span>
              ),
            },
            { title: tx('মৌজা'), dataIndex: 'mouza', render: (v: string | null) => v || '—' },
          ]}
        />
      </Drawer>
    </PageFrame>
  )
}
