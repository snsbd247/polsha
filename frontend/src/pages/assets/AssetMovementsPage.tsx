import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, DatePicker, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, CheckCircleFilled, EyeFilled, InboxOutlined, RollbackOutlined, SearchOutlined, SwapOutlined, ToolFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { CONDITION_TONE, MOVE_TONE, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import { ALLOWED, AssetPickModal, MOVE_LABEL, MovementModal, journalLink, type AssetLike, type Movement, type MoveType } from './AssetModals'
import type { AssetRow } from './AssetListPage'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'

type Preset = 'transfer' | 'install' | 'repair'
type Row = Movement & { asset: AssetRow }
type Resp = Paginated<Row> & {
  types: Record<string, string>
  counts: { total: number; month: number; assets: number; by_type: Record<string, number>; by_status: Record<string, number> }
}
type Filters = { search?: string; type?: string; from?: string; to?: string }

const PRESET: Record<Preset, { title: string; types: MoveType[] }> = {
  transfer: { title: tx('সম্পদ স্থানান্তর'), types: ['transfer'] },
  install: { title: tx('স্থাপন'), types: ['install', 'uninstall'] },
  repair: { title: tx('মেরামত'), types: ['repair', 'repaired'] },
}
const MOVE_ICON: Partial<Record<MoveType, ReactNode>> = { transfer: <SwapOutlined />, install: <CheckCircleFilled />, uninstall: <RollbackOutlined />, repair: <ToolFilled />, repaired: <CheckCircleFilled /> }

/** Movement log across all assets for the Transfer / Installation / Repair menu items; new moves can start here too. */
export default function AssetMovementsPage({ preset }: { preset: Preset }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const meta = useAssetMeta()
  const p = PRESET[preset]
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [picking, setPicking] = useState<MoveType | null>(null)
  const [moving, setMoving] = useState<{ type: MoveType; asset: AssetLike } | null>(null)

  const params = { page, per_page: perPage, types: p.types.join(','), ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['asset-movements', params],
    queryFn: async () => (await api.get<Resp>('/assets/movements', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const byType = (k: string) => (data ? Number(c?.by_type[k] ?? 0) : undefined)
  const byStatus = (k: string) => (data ? Number(c?.by_status[k] ?? 0) : undefined)
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({ from: f.from ? dayjs(f.from) : null, to: f.to ? dayjs(f.to) : null })
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const month = { from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') }
  const refresh = () => {
    for (const k of ['asset-movements', 'assets', 'asset', 'asset-dashboard']) queryClient.invalidateQueries({ queryKey: [k] })
  }

  const cards = {
    transfer: [
      { key: 'total', label: tx('মোট স্থানান্তর'), value: c?.total, icon: '', glyph: <SwapOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
      { key: 'month', label: tx('এই মাসে'), value: c?.month, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show(month) },
      { key: 'assets', label: tx('স্থানান্তরিত সম্পদ'), value: c?.assets, icon: '', glyph: <AppstoreFilled />, color: '#8b3fe0', tint: '#efe4fc' },
      {
        key: 'live',
        label: tx('স্থাপিত / স্টকে'),
        value: data ? `${n0(byStatus('installed') ?? 0)} / ${n0(byStatus('in_stock') ?? 0)}` : undefined,
        icon: '',
        glyph: <InboxOutlined />,
        color: '#1f9d55',
        tint: '#dcf3e5',
        onClick: () => navigate('/assets'),
      },
    ],
    install: [
      { key: 'install', label: tx('মোট স্থাপন'), value: byType('install'), icon: '', solid: <CheckCircleFilled />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ type: 'install' }) },
      { key: 'uninstall', label: tx('স্টকে ফেরত'), value: byType('uninstall'), icon: '', glyph: <RollbackOutlined />, color: '#6b7280', tint: '#eef0f3', onClick: () => show({ type: 'uninstall' }) },
      { key: 'installed', label: tx('এখন স্থাপিত'), value: byStatus('installed'), icon: '', glyph: <AppstoreFilled />, color: '#0e9f9a', tint: '#d9f4f2', onClick: () => navigate('/assets') },
      { key: 'stock', label: tx('স্টকে আছে (স্থাপনযোগ্য)'), value: byStatus('in_stock'), icon: '', glyph: <InboxOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/assets/stock') },
    ],
    repair: [
      { key: 'repair', label: tx('মেরামতে পাঠানো'), value: byType('repair'), icon: '', glyph: <ToolFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ type: 'repair' }) },
      { key: 'repaired', label: tx('মেরামত শেষ'), value: byType('repaired'), icon: '', solid: <CheckCircleFilled />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ type: 'repaired' }) },
      { key: 'now', label: tx('এখন মেরামতে'), value: byStatus('in_repair'), icon: '', glyph: <ToolFilled />, color: '#e5383b', tint: '#fde4e5' },
      { key: 'month', label: tx('এই মাসে'), value: c?.month, icon: '', glyph: <CalendarFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show(month) },
    ],
  }[preset]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    {
      title: tx('সম্পদ'),
      render: (_, m) =>
        m.asset ? (
          <span className="hs-two">
            <Link to={`/assets/${m.asset.id}`} className="mg-name">
              {nameOf(m.asset)}
            </Link>
            <span>{digits(m.asset.asset_code)}</span>
          </span>
        ) : (
          '—'
        ),
    },
    ...(p.types.length > 1 ? [{ title: tx('ধরন'), dataIndex: 'type', render: (v: string) => <Tag className={`fl-tag ${MOVE_TONE[v] ?? 'll-gray'}`}>{data?.types[v] ?? v}</Tag> }] : []),
    {
      title: tx('থেকে → যেখানে'),
      render: (_, m) => (
        <span className="hs-two">
          <span>{m.to_location || '—'}</span>
          {m.from_location && <span>{tx('আগে: {{p0}}', { p0: m.from_location })}</span>}
        </span>
      ),
    },
    { title: tx('দায়িত্বপ্রাপ্ত'), dataIndex: 'custodian', render: (v: string | null) => v || '—' },
    { title: tx('অবস্থা'), dataIndex: 'condition', render: (v: string | null) => (v ? <Tag className={`fl-tag ${CONDITION_TONE[v] ?? 'll-gray'}`}>{meta.data?.conditions[v] ?? v}</Tag> : '—') },
    ...(preset === 'repair' ? [{ title: tx('খরচ (৳)'), dataIndex: 'amount', align: 'right' as const, render: moneyOrBlank }] : []),
    { title: tx('নোট'), dataIndex: 'note', render: (v: string | null) => v || '—' },
    ...(preset === 'repair' ? [{ title: tx('ভাউচার'), render: (_: unknown, m: Row) => journalLink(m.journal, can('accounting.view')) ?? '—' }] : []),
    { title: tx('করেছেন'), render: (_, m) => nameOf(m.creator) || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, m) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/assets/${m.asset.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সম্পদ'), to: '/assets/dashboard' }}
      title={p.title}
      subtitle=""
      actions={
        can('asset.edit') &&
        p.types.map((t, i) => (
          <Button key={t} type={i === 0 ? 'primary' : 'default'} icon={MOVE_ICON[t]} onClick={() => setPicking(t)}>
            {MOVE_LABEL[t]}
          </Button>
        ))
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={300}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('সম্পদ, অবস্থান বা দায়িত্বপ্রাপ্ত...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
          {p.types.length > 1 && (
            <Field label={tx('ধরন')}>
              <Select value={draft.type ?? ''} options={[{ value: '', label: tx('সকল') }, ...p.types.map((t) => ({ value: t, label: data?.types[t] ?? MOVE_LABEL[t] }))]} onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))} />
            </Field>
          )}
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('রেকর্ড'), p1: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Row>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো রেকর্ড পাওয়া যায়নি') }}
      />
      <AssetPickModal open={!!picking} title={picking ? MOVE_LABEL[picking] : ''} statuses={picking ? ALLOWED[picking] : []} onClose={() => setPicking(null)} onPick={(asset) => picking && setMoving({ type: picking, asset })} />
      {moving && <MovementModal asset={moving.asset} type={moving.type} onClose={() => setMoving(null)} onDone={refresh} />}
    </ListFrame>
  )
}
