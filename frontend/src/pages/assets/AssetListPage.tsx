import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AppstoreFilled,
  AppstoreOutlined,
  CalculatorOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  DollarCircleFilled,
  DownOutlined,
  EditFilled,
  EyeFilled,
  FallOutlined,
  InboxOutlined,
  PlusOutlined,
  PrinterOutlined,
  SearchOutlined,
  StopOutlined,
  ToolFilled,
  WalletFilled,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { ASSET_TONE, CONDITION_TONE, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import { AssetPickModal, DisposeModal, LIVE, type AssetLike } from './AssetModals'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'

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
type Resp = Paginated<AssetRow> & { totals: { count: number; cost: number; accumulated: number; book_value: number }; status_counts: Record<string, number> }
type Filters = { status?: string; category_id?: number; condition?: string; acquisition?: string; search?: string }

type Preset = 'stock' | 'disposal'
const PRESET: Record<Preset, { title: string; status: string }> = {
  stock: { title: tx('স্টক'), status: 'in_stock' },
  disposal: { title: tx('বিক্রয়'), status: 'disposal' },
}
const DISPOSAL = ['disposal_pending', 'sold', 'disposed']

/** Asset register; the Stock and Sales menu items are this list with a fixed status. */
export default function AssetListPage({ preset }: { preset?: Preset }) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const meta = useAssetMeta()
  const fixed = preset ? PRESET[preset] : null
  const start: Filters = { status: fixed?.status ?? 'active' }
  const [draft, setDraft] = useState<Filters>(start)
  const [filters, setFilters] = useState<Filters>(start)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [picking, setPicking] = useState(false)
  const [disposing, setDisposing] = useState<AssetLike | null>(null)
  const queryClient = useQueryClient()

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['assets', params],
    queryFn: async () => (await api.get<Resp>('/assets', { params })).data,
    placeholderData: keepPreviousData,
  })
  const t = data?.totals
  const sc = data?.status_counts ?? {}
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    const next = { ...start, ...f }
    setDraft(next)
    setFilters(next)
    setPage(1)
  }
  const apply = () => {
    setFilters(draft)
    setPage(1)
  }
  const amt = (v?: number) => (data ? `৳ ${money(v ?? 0)}` : undefined)
  const exportCsv = () => downloadExport('/assets', { ...filters, export: 'csv' }, 'asset-register.csv').catch((e) => message.error(errorMessage(e)))

  const cards =
    preset === 'disposal'
      ? [
          {
            key: 'pending',
            label: tx('অনুমোদনের অপেক্ষায়'),
            value: data ? (sc.disposal_pending ?? 0) : undefined,
            icon: '',
            glyph: <ClockCircleFilled />,
            color: '#f08c00',
            tint: '#fdefd6',
            onClick: () => show({ status: 'disposal_pending' }),
          },
          { key: 'sold', label: tx('বিক্রীত'), value: data ? (sc.sold ?? 0) : undefined, icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ status: 'sold' }) },
          { key: 'disposed', label: tx('বাতিলকৃত (অকেজো)'), value: data ? (sc.disposed ?? 0) : undefined, icon: '', glyph: <StopOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'disposed' }) },
          { key: 'all', label: tx('মোট'), value: data ? DISPOSAL.reduce((s, k) => s + Number(sc[k] ?? 0), 0) : undefined, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
        ]
      : preset === 'stock'
        ? [
            { key: 'stock', label: tx('স্টকে আছে'), value: data ? (sc.in_stock ?? 0) : undefined, icon: '', glyph: <InboxOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
            { key: 'value', label: tx('স্টকের বর্তমান মূল্য'), value: amt(t?.book_value), icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5' },
            { key: 'installed', label: tx('স্থাপিত সম্পদ'), value: data ? (sc.installed ?? 0) : undefined, icon: '', solid: <CheckCircleFilled />, color: '#0e9f9a', tint: '#d9f4f2', onClick: () => navigate('/assets') },
            { key: 'repair', label: tx('মেরামতে আছে'), value: data ? (sc.in_repair ?? 0) : undefined, icon: '', glyph: <ToolFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => navigate('/assets/repairs') },
          ]
        : [
            { key: 'count', label: tx('সম্পদ সংখ্যা'), value: t?.count, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
            { key: 'cost', label: tx('ক্রয়মূল্য'), value: amt(t?.cost), icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc' },
            { key: 'acc', label: tx('পুঞ্জীভূত অবচয়'), value: amt(t?.accumulated), icon: '', glyph: <FallOutlined />, color: '#e5383b', tint: '#fde4e5' },
            { key: 'book', label: tx('বর্তমান মূল্য'), value: amt(t?.book_value), icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5' },
          ]

  const statusOptions =
    preset === 'disposal'
      ? [{ value: 'disposal', label: tx('সকল') }, ...DISPOSAL.map((s) => ({ value: s, label: meta.data?.statuses[s] ?? s }))]
      : [
          { value: 'active', label: tx('চালু সব সম্পদ') },
          { value: 'disposal', label: tx('বিক্রয়/বাতিল সংক্রান্ত') },
          { value: '', label: tx('সকল') },
          ...Object.entries(meta.data?.statuses ?? {}).map(([value, label]) => ({ value, label })),
        ]
  const opts = (m?: Record<string, string>) => [{ value: '', label: tx('সকল') }, ...Object.entries(m ?? {}).map(([value, label]) => ({ value, label }))]

  const columns: ColumnsType<AssetRow> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('সম্পদ কোড'),
      dataIndex: 'asset_code',
      render: (v: string, r) => (
        <Link to={`/assets/${r.id}`} className="fl-link iv-no">
          {digits(v)}
        </Link>
      ),
    },
    {
      title: tx('সম্পদ'),
      render: (_, r) => (
        <span className="hs-two">
          <Link to={`/assets/${r.id}`} className="mg-name">
            {nameOf(r)}
          </Link>
          <span>{[r.brand_model, r.serial_no && digits(r.serial_no)].filter(Boolean).join(' · ') || nameOf(r.category)}</span>
        </span>
      ),
    },
    { title: tx('শ্রেণি'), render: (_, r) => nameOf(r.category) || '—' },
    { title: tx('ক্রয়ের তারিখ'), dataIndex: 'purchase_date', render: fmtDate },
    { title: tx('ক্রয়মূল্য (৳)'), dataIndex: 'cost', align: 'right', render: money },
    { title: tx('বর্তমান মূল্য (৳)'), dataIndex: 'book_value', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
    {
      title: tx('অবস্থান'),
      render: (_, r) => (
        <span className="hs-two">
          <span>{r.location ?? nameOf(r.mouza) ?? '—'}</span>
          {r.custodian && <span>{r.custodian}</span>}
        </span>
      ),
    },
    { title: tx('ভৌত অবস্থা'), dataIndex: 'condition', render: (v: string | null) => (v ? <Tag className={`fl-tag ${CONDITION_TONE[v] ?? 'll-gray'}`}>{meta.data?.conditions[v] ?? v}</Tag> : '—') },
    { title: tx('স্ট্যাটাস'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${ASSET_TONE[v] ?? 'll-gray'}`}>{meta.data?.statuses[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/assets/${r.id}`)} />
          {can('asset.edit') && <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => navigate(`/assets/${r.id}/edit`)} />}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('সম্পদ'), to: '/assets/dashboard' }}
      title={fixed?.title ?? tx('সম্পদ রেজিস্টার')}
      subtitle=""
      actions={
        <>
          <Button icon={<AppstoreOutlined />} onClick={() => navigate('/assets/categories')}>
            {tx('সম্পদের শ্রেণি')}
          </Button>
          <Button icon={<CalculatorOutlined />} onClick={() => navigate('/assets/depreciation')}>
            {tx('অবচয়')}
          </Button>
          {can('asset.create') && preset !== 'disposal' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/assets/new')}>
              {tx('নতুন সম্পদ')}
            </Button>
          )}
          {can('asset.edit') && preset === 'disposal' && (
            <Button type="primary" danger icon={<StopOutlined />} onClick={() => setPicking(true)}>
              {tx('বিক্রয় / বাতিলের আবেদন')}
            </Button>
          )}
        </>
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={300}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('কোড, নাম, সিরিয়াল, অবস্থান বা দায়িত্বপ্রাপ্ত...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          {preset !== 'stock' && (
            <Field label={tx('স্ট্যাটাস')}>
              <Select value={draft.status ?? ''} options={statusOptions} onChange={(v) => set({ status: v })} />
            </Field>
          )}
          <Field label={tx('শ্রেণি')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.category_id ?? 0}
              options={[{ value: 0, label: tx('সকল') }, ...(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: nameOf(c) }))]}
              onChange={(v) => set({ category_id: v || undefined })}
            />
          </Field>
          <Field label={tx('ভৌত অবস্থা')}>
            <Select value={draft.condition ?? ''} options={opts(meta.data?.conditions)} onChange={(v) => set({ condition: v || undefined })} />
          </Field>
          <Field label={tx('অর্জনের ধরন')}>
            <Select value={draft.acquisition ?? ''} options={opts(meta.data?.acquisitions)} onChange={(v) => set({ acquisition: v || undefined })} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: fixed?.title ?? tx('সম্পদের তালিকা'), p1: n0(total) })}
      tableTools={
        <>
          <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'csv', label: 'Excel (CSV)', onClick: exportCsv }] }}>
            <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
              {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
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
      <Table<AssetRow>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো সম্পদ পাওয়া যায়নি') }}
      />
      <AssetPickModal open={picking} title={tx('বিক্রয় / বাতিলের আবেদন')} statuses={LIVE} onClose={() => setPicking(false)} onPick={setDisposing} />
      {disposing && <DisposeModal asset={disposing} open onClose={() => setDisposing(null)} onDone={() => queryClient.invalidateQueries({ queryKey: ['assets'] })} />}
    </ListFrame>
  )
}
