import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Spin, Table, Tag } from 'antd'
import { AppstoreFilled, CalendarFilled, DollarCircleFilled, FallOutlined, HistoryOutlined, PieChartFilled, PlusOutlined, ScanOutlined, SafetyCertificateFilled, ToolFilled, WalletFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { ASSET_TONE, CONDITION_TONE, MOVE_TONE } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import './assets.css'

type Money = { count: number; cost: number; book_value: number }
type AssetRef = { id: number; asset_code: string; name_bn: string; name_en: string | null }
type Dash = {
  totals: Money & { accumulated: number }
  by_status: (Money & { status: string })[]
  by_category: (Money & { category: { id: number; code: string; name_bn: string; name_en: string | null } | null })[]
  by_condition: Record<string, number>
  maintenance: { overdue: number; due_30: number; upcoming: { id: number; title: string; due_on: string; asset: AssetRef }[] }
  last_depreciation: string | null
  movements: { id: number; type: string; date: string; to_location: string | null; asset: AssetRef }[]
  statuses: Record<string, string>
  conditions: Record<string, string>
  movement_types: Record<string, string>
}

const STATUS_PATH: Record<string, string> = { in_stock: '/assets/stock', in_repair: '/assets/repairs', disposal_pending: '/assets/sales', sold: '/assets/sales', disposed: '/assets/sales' }
const BAR: Record<string, string> = {
  in_stock: '#1769e0',
  installed: '#1f9d55',
  in_repair: '#f08c00',
  disposal_pending: '#d4a106',
  disposed: '#9ca3af',
  sold: '#8b3fe0',
  good: '#1f9d55',
  fair: '#1769e0',
  poor: '#f08c00',
  damaged: '#e5383b',
}

/** A bar per row, as long as its share of the largest value. */
function Bars({ rows }: { rows: { key: string; label: ReactNode; value: number; note?: string; color: string; to?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="as-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="as-bar-label">{r.to ? <Link to={r.to}>{r.label}</Link> : r.label}</span>
          <span className="as-bar-track">
            <span className="as-bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </span>
          <span className="as-bar-value">
            {n0(r.value)}
            {r.note && <small>{r.note}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The asset overview: value, where assets stand, their condition, service due and the latest moves. */
export default function AssetDashboardPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: d, isLoading } = useQuery({ queryKey: ['asset-dashboard'], queryFn: async () => (await api.get<Dash>('/assets/dashboard')).data })
  if (isLoading || !d) return <Spin style={{ display: 'block', marginTop: 64 }} />
  const thisMonth = new Date().toISOString().slice(0, 7)
  const today = new Date().toISOString().slice(0, 10)

  const cards = [
    { key: 'count', label: tx('চালু সম্পদ'), value: d.totals.count, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/assets') },
    { key: 'cost', label: tx('ক্রয়মূল্য'), value: `৳ ${money(d.totals.cost)}`, icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'acc', label: tx('পুঞ্জীভূত অবচয়'), value: `৳ ${money(d.totals.accumulated)}`, icon: '', glyph: <FallOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => navigate('/assets/depreciation') },
    { key: 'book', label: tx('বর্তমান মূল্য'), value: `৳ ${money(d.totals.book_value)}`, icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5' },
  ]

  return (
    <PageFrame
      className="ml pl id-page"
      crumbs={[{ label: tx('সম্পদ'), to: '/assets/dashboard' }, { label: tx('সম্পদ ড্যাশবোর্ড') }]}
      title={tx('সম্পদ ড্যাশবোর্ড')}
      actions={
        <span className="id-actions">
          <Button icon={<ScanOutlined />} className="fm-history-btn" onClick={() => navigate('/qr/scan')}>
            {tx('QR স্ক্যানার')}
          </Button>
          {can('asset.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/assets/new')}>
              {tx('নতুন সম্পদ')}
            </Button>
          )}
        </span>
      }
    >
      {d.last_depreciation !== thisMonth && d.totals.count > 0 && (
        <Alert
          className="id-alert"
          type="warning"
          showIcon
          title={tx('সর্বশেষ অবচয়: {{p0}}।', { p0: d.last_depreciation ? digits(d.last_depreciation) : tx('এখনও চালানো হয়নি') })}
          action={
            <Button size="small" onClick={() => navigate('/assets/depreciation')}>
              {tx('অবচয় চালান')}
            </Button>
          }
        />
      )}

      <StatRow cards={cards} />

      <div className="as-dash">
        <Box icon={<PieChartFilled />} title={tx('স্ট্যাটাস অনুযায়ী')}>
          <Bars
            rows={d.by_status.map((s) => ({
              key: s.status,
              label: <Tag className={`fl-tag ${ASSET_TONE[s.status] ?? 'll-gray'}`}>{d.statuses[s.status] ?? s.status}</Tag>,
              value: s.count,
              note: `৳ ${money(s.book_value)}`,
              color: BAR[s.status] ?? '#9ca3af',
              to: STATUS_PATH[s.status] ?? '/assets',
            }))}
          />
        </Box>
        <Box icon={<SafetyCertificateFilled />} title={tx('ভৌত অবস্থা (চালু সম্পদ)')}>
          <Bars
            rows={Object.entries(d.conditions).map(([k, label]) => ({
              key: k,
              label: <Tag className={`fl-tag ${CONDITION_TONE[k] ?? 'll-gray'}`}>{label}</Tag>,
              value: Number(d.by_condition[k] ?? 0),
              color: BAR[k] ?? '#9ca3af',
            }))}
          />
        </Box>
        <Box icon={<ToolFilled />} title={tx('সার্ভিস ও মেরামত')}>
          <div className="as-maint">
            <button type="button" className={d.maintenance.overdue ? 'bad' : ''} onClick={() => navigate('/assets/maintenances')}>
              <strong>{n0(d.maintenance.overdue)}</strong>
              <span>{tx('মেয়াদোত্তীর্ণ')}</span>
            </button>
            <button type="button" onClick={() => navigate('/assets/maintenances')}>
              <strong>{n0(d.maintenance.due_30)}</strong>
              <span>{tx('৩০ দিনের মধ্যে')}</span>
            </button>
          </div>
          <ul className="as-list">
            {d.maintenance.upcoming.map((m) => (
              <li key={m.id}>
                <span className={m.due_on < today ? 'as-late' : ''}>
                  <CalendarFilled /> {fmtDate(m.due_on)}
                </span>
                <span>
                  <Link to={`/assets/${m.asset.id}`}>{nameOf(m.asset)}</Link> — {m.title}
                </span>
              </li>
            ))}
            {d.maintenance.upcoming.length === 0 && <li className="as-none">{tx('কোনো কাজ নির্ধারিত নেই')}</li>}
          </ul>
        </Box>
      </div>

      <div className="id-two">
        <Box icon={<AppstoreFilled />} title={tx('শ্রেণি অনুযায়ী (চালু)')}>
          <Table
            rowKey={(r) => r.category?.id ?? 0}
            size="small"
            className="id-payments"
            pagination={false}
            dataSource={d.by_category}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: tx('কোনো সম্পদ নেই') }}
            columns={[
              { title: tx('শ্রেণি'), render: (_, r) => nameOf(r.category) || '—' },
              { title: tx('সংখ্যা'), dataIndex: 'count', align: 'right', render: (v: number) => n0(v) },
              { title: tx('ক্রয়মূল্য (৳)'), dataIndex: 'cost', align: 'right', render: money },
              { title: tx('বর্তমান মূল্য (৳)'), dataIndex: 'book_value', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
            ]}
          />
        </Box>
        <Box icon={<HistoryOutlined />} title={tx('সাম্প্রতিক চলাচল')}>
          <ul className="as-list">
            {d.movements.map((m) => (
              <li key={m.id}>
                <span>{fmtDate(m.date)}</span>
                <span>
                  <Link to={`/assets/${m.asset.id}`}>{nameOf(m.asset)}</Link> <Tag className={`fl-tag ${MOVE_TONE[m.type] ?? 'll-gray'}`}>{d.movement_types[m.type] ?? m.type}</Tag>
                  {m.to_location ? ` → ${m.to_location}` : ''}
                </span>
              </li>
            ))}
            {d.movements.length === 0 && <li className="as-none">{tx('এখনও কোনো চলাচল নেই')}</li>}
          </ul>
        </Box>
      </div>
    </PageFrame>
  )
}
