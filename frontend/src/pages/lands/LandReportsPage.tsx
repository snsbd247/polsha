import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, ConfigProvider, DatePicker, Dropdown, Form, Modal, Pagination, Radio, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteFilled,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownloadOutlined,
  DownOutlined,
  EyeFilled,
  FileTextOutlined,
  HomeFilled,
  HomeOutlined,
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
  AppstoreFilled,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import ReportView from '../../components/ReportView'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { usePublicSettings } from '../../lib/settings'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres, exportReport, n0 } from './ListFrame'
import '../farmers/farmer-list.css'
import '../membership/member-list.css'
import '../masters/patwari-list.css'
import '../farmers/deleted-farmers.css'
import './land-list.css'
import './land-reports.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './land-report-page.css'

type Part = { key?: string; id?: number | null; name?: string; label?: string; lands: number; area_decimal: number }
type Summary = {
  lands: number
  area_decimal: number
  owners: number
  cultivated_decimal: number
  transferred_decimal: number
  irrigated_decimal: number
  by_type: Part[]
  ownership: Part[]
  by_status: Part[]
}
type ReportType = { value: string; key: string; label: string; title: string }
type Generated = {
  id: number
  type: string | null
  report_key: string
  title: string
  type_label: string | null
  generated_for: string
  from: string | null
  to: string | null
  filters: Record<string, unknown>
  format: 'print' | 'xlsx' | 'csv'
  rows: number
  created_at: string
  can_remove: boolean
}
type Place = { id: number; name_bn: string; district_id?: number }
type Filters = { type?: string; mouza_id?: number; upazila_id?: number; district_id?: number; from?: string; to?: string }

// fixed colours, given to each land type by its place in the type list (not by its size), as in the design
const SERIES = ['#2fae5f', '#3d8bf2', '#f5873a', '#4cc3e6', '#9b5cf0', '#8a93a3']
const OWNERSHIP: Record<string, string> = { single: '#3d8bf2', joint: '#2fae5f', none: '#8a93a3' }
const STATUS: Record<string, string> = { cultivated: '#2fae5f', fallow: '#f5873a', seasonal: '#4cc3e6', leased: '#9b5cf0' }
const TYPE_TONE: Record<string, string> = { summary: 'll-blue', type: 'll-green', ownership: 'll-orange', cultivation: 'll-purple', borga: 'll-purple', transfer: 'll-gold', irrigation: 'hs-teal', detailed: 'll-gray' }
const FILE: Record<Generated['format'], [string, string]> = { print: ['PDF', 'lrp-pdf'], xlsx: ['Excel', 'lrp-xlsx'], csv: ['CSV', 'lrp-csv'] }

function niceTop(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 }
  const raw = max / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  return { top: step * Math.ceil(max / step), step }
}

/** Vertical bars of area (acres) per land type, the value written on each bar. */
function TypeBars({ parts, colorOf }: { parts: Part[]; colorOf: (p: Part) => string }) {
  const values = parts.map((p) => p.area_decimal / 100)
  const { top, step } = niceTop(Math.max(0, ...values))
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  if (!parts.length) return <div className="lr-empty">{tx('কোনো জমি নেই')}</div>
  return (
    <div className="lrp-bars">
      <div className="lrp-axis">
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <span key={t}>{digits(Math.round(t).toLocaleString('en-IN'))}</span>
          ))}
      </div>
      <div className="lrp-plot">
        {ticks.map((t) => (
          <span key={t} className="lrp-grid" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        {parts.map((p, i) => (
          <Tooltip key={`${p.id ?? 'none'}`} title={`${p.name}: ${acres(p.area_decimal)} ${tx('একর')} · ${tx('{{p0}}টি জমি', { p0: n0(p.lands) })}`}>
            <Link to={p.id ? `/lands?land_type_id=${p.id}` : '/lands'} className="lrp-col">
              <span className="lrp-val">{digits(Math.round(values[i]).toLocaleString('en-IN'))}</span>
              <span className="lrp-bar" style={{ height: `${(values[i] / top) * 100}%`, background: colorOf(p) }} />
            </Link>
          </Tooltip>
        ))}
      </div>
      <div className="lrp-names">
        {parts.map((p) => (
          <span key={`${p.id ?? 'none'}`}>{p.name}</span>
        ))}
      </div>
    </div>
  )
}

/** A donut of area shares with the total in the middle and a legend of %, and area. */
function Donut({ parts, colors, total }: { parts: Part[]; colors: (p: Part) => string; total: number }) {
  const r = 58
  const c = 2 * Math.PI * r
  const sum = parts.reduce((s, p) => s + p.area_decimal, 0) || 1
  const gap = parts.length > 1 ? 2 : 0
  let offset = 0
  return (
    <div className="lrp-donut-wrap">
      <div className="lrp-donut">
        <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={tx('মোট {{p0}} একর', { p0: acres(total) })}>
          <circle cx="80" cy="80" r={r} fill="none" stroke="#eef1f5" strokeWidth="24" />
          {parts.map((p) => {
            const len = (p.area_decimal / sum) * c
            const seg = (
              <circle
                key={p.key ?? p.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={colors(p)}
                strokeWidth="24"
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
              >
                <title>{`${p.label}: ${acres(p.area_decimal)} ${tx('একর')}`}</title>
              </circle>
            )
            offset += len
            return seg
          })}
        </svg>
        <div className="lrp-donut-center">
          <strong>{digits(Math.round(total / 100).toLocaleString('en-IN'))}</strong>
          <span>{tx('একর')}</span>
        </div>
      </div>
      <ul className="lrp-legend">
        {parts.map((p) => (
          <li key={p.key ?? p.label}>
            <span className="lrp-dot" style={{ background: colors(p) }} />
            <span className="lrp-legend-name">{p.label}</span>
            <span className="lrp-legend-val">
              {digits(Math.round((p.area_decimal / sum) * 100).toString())}% ({acres(p.area_decimal)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Land figures and charts for the chosen area, and the land reports generated so far. */
export default function LandReportsPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: settings } = usePublicSettings()
  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [selected, setSelected] = useState<number[]>([])
  const [viewing, setViewing] = useState<Generated | null>(null)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  const area = { mouza_id: filters.mouza_id, upazila_id: filters.upazila_id, district_id: filters.district_id, from: filters.from, to: filters.to }
  const summary = useQuery({ queryKey: ['land-reports', 'summary', area], queryFn: async () => (await api.get<Summary>('/land-reports/summary', { params: area })).data, placeholderData: keepPreviousData })
  const listParams = { page, per_page: perPage, type: filters.type, mouza_id: filters.mouza_id, from: filters.from, to: filters.to }
  const list = useQuery({
    queryKey: ['land-reports', 'generated', listParams],
    queryFn: async () => (await api.get<Paginated<Generated>>('/land-reports/generated', { params: listParams })).data,
    placeholderData: keepPreviousData,
  })
  const meta = useQuery({ queryKey: ['land-reports', 'meta'], queryFn: async () => (await api.get<{ types: ReportType[] }>('/land-reports/meta')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const places = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ districts: Place[]; upazilas: Place[] }>('/mouzas-summary')).data })
  const landMeta = useQuery({ queryKey: ['land-meta'], queryFn: async () => (await api.get<{ land_types: { id: number }[] }>('/lands/meta')).data, staleTime: 300_000 })

  const s = summary.data
  const types = meta.data?.types ?? []
  const total = list.data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !draft.district_id || u.district_id === draft.district_id)
  const all = [{ value: '', label: tx('সকল') }]
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  // a type keeps its colour whatever its size: colour by its place in the land type list
  const typeOrder = (landMeta.data?.land_types ?? []).map((t) => t.id)
  const typeColor = (p: Part) => (p.id ? SERIES[Math.max(0, typeOrder.indexOf(p.id)) % (SERIES.length - 1)] : SERIES[SERIES.length - 1])

  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const reset = () => {
    setDraft({})
    setFilters({})
    setRange({})
    setPage(1)
  }
  const run = async (key: string, f: Record<string, unknown>, format: 'print' | 'xlsx' | 'csv') => {
    setBusy(true)
    try {
      await exportReport(key, f, format, society)
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['land-reports', 'generated'] }), 600)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const generate = async () => {
    const v = await form.validateFields()
    const t = types.find((x) => x.value === v.type)
    if (!t) return
    const f: Record<string, unknown> = { mouza_id: v.mouza_id || undefined, from: v.period?.[0]?.format('YYYY-MM-DD'), to: v.period?.[1]?.format('YYYY-MM-DD') }
    await run(t.key, f, v.format)
    setGenerating(false)
  }
  const remove = (g: Generated) =>
    Modal.confirm({
      title: tx('"{{p0}}" তালিকা থেকে সরাবেন?', { p0: g.title }),
      content: tx('রিপোর্টটি এক্সপোর্টের লগে থেকে যাবে।'),
      okText: tx('সরান'),
      okButtonProps: { danger: true },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/land-reports/generated/${g.id}`)
          message.success(r.data.message)
          queryClient.invalidateQueries({ queryKey: ['land-reports', 'generated'] })
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const cards: { key: string; label: string; value?: number; unit: string; icon: ReactNode; color: string; tint: string }[] = [
    { key: 'area', label: tx('সমিতির মোট জমি'), value: s && s.area_decimal / 100, unit: tx('একর'), icon: <DashIcon name="sprout" size={32} color="#1f9d55" stroke={2.1} />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'owners', label: tx('মোট মালিক'), value: s?.owners, unit: tx('জন'), icon: <DashIcon name="users" size={32} color="#1769e0" stroke={2.1} />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'cultivated', label: tx('চাষের অধীন জমি'), value: s && s.cultivated_decimal / 100, unit: tx('একর'), icon: <DashIcon name="sprout" size={32} color="#f08c00" stroke={2.1} />, color: '#f08c00', tint: '#fdefd6' },
    { key: 'transferred', label: tx('হস্তান্তরিত জমি'), value: s && s.transferred_decimal / 100, unit: tx('একর'), icon: <HomeFilled style={{ fontSize: 30, color: '#8b3fe0' }} />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'irrigated', label: tx('সেচের আওতায় জমি'), value: s && s.irrigated_decimal / 100, unit: tx('একর'), icon: <DashIcon name="drop" size={30} color="#0e9f9a" stroke={2.1} />, color: '#0e9f9a', tint: '#d9f4f2' },
  ]

  const columns: ColumnsType<Generated> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('রিপোর্টের নাম'),
      dataIndex: 'title',
      render: (v, g) => (
        <button type="button" className="lt-name" onClick={() => setViewing(g)}>
          {v}
        </button>
      ),
    },
    { title: tx('রিপোর্টের ধরন'), dataIndex: 'type_label', render: (v, g) => (v ? <Tag className={`fl-tag ${TYPE_TONE[g.type ?? ''] ?? 'll-gray'}`}>{v}</Tag> : '—') },
    { title: tx('যার জন্য'), dataIndex: 'generated_for' },
    { title: tx('সময়কাল'), render: (_, g) => (g.from || g.to ? `${g.from ? fmtDate(g.from) : '…'} – ${g.to ? fmtDate(g.to) : '…'}` : tx('সব সময়')) },
    { title: tx('তৈরির সময়'), dataIndex: 'created_at', render: fmtDateTime },
    { title: tx('মোট রেকর্ড'), dataIndex: 'rows', align: 'center', render: (v: number) => n0(v) },
    { title: tx('ফাইল'), dataIndex: 'format', align: 'center', render: (f: Generated['format']) => <Tag className={`fl-tag ${FILE[f]?.[1]}`}>{FILE[f]?.[0] ?? f}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, g) => (
        <div className="lt-actions mg-actions">
          <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setViewing(g)} />
          <Button type="text" className="mg-view" icon={<DownloadOutlined />} aria-label={tx('ডাউনলোড')} disabled={busy} onClick={() => run(g.report_key, g.filters, g.format)} />
          <Button type="text" className="mg-view lt-del" icon={<DeleteFilled />} aria-label={tx('সরান')} disabled={!g.can_remove} onClick={() => remove(g)} />
        </div>
      ),
    },
  ]

  return (
    // the approved designs use a blue accent on these pages, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl ml pl lrp">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/lands">{tx('জমি ব্যবস্থাপনা')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('জমির রিপোর্ট')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('জমির রিপোর্ট')}</h1>
            <p>{tx('জমির রেকর্ড, মালিকানা, চাষাবাদ, হস্তান্তর ও অন্যান্য কার্যক্রমের বিভিন্ন রিপোর্ট তৈরি করুন ও দেখুন।')}</p>
          </div>
          <div className="fl-head-btns">
            <Button type="primary" icon={<FileTextOutlined />} onClick={() => setGenerating(true)}>
              {tx('রিপোর্ট তৈরি করুন')}
            </Button>
          </div>
        </div>

        <div className="lrp-stats">
          {cards.map((c) => (
            <div key={c.key} className="fl-stat mz-stat" style={{ ['--tint' as string]: c.tint }}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                {c.icon}
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-value">{c.value === undefined ? '—' : digits(c.value.toLocaleString('en-IN', { maximumFractionDigits: c.value >= 100 || c.key === 'owners' ? 0 : 2 }))}</span>
                <span className="lrp-unit">{c.unit}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="dl-filters pl-filters lrp-filters">
          <div className="fl-field">
            <span>{tx('রিপোর্টের ধরন')}</span>
            <Select value={draft.type ?? ''} options={[{ value: '', label: tx('সব রিপোর্ট') }, ...types.map((t) => ({ value: t.value, label: t.title }))]} onChange={(v) => set({ type: v || undefined })} />
          </div>
          <div className="fl-field">
            <span>{tx('মৌজা')}</span>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.mouza_id ?? ''} options={[...all, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]} onChange={(v) => set({ mouza_id: v === '' ? undefined : Number(v) })} />
          </div>
          <div className="fl-field">
            <span>{tx('উপজেলা')}</span>
            <Select value={draft.upazila_id ?? ''} options={[...all, ...upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))]} onChange={(v) => set({ upazila_id: v === '' ? undefined : Number(v) })} />
          </div>
          <div className="fl-field">
            <span>{tx('জেলা')}</span>
            <Select value={draft.district_id ?? ''} options={[...all, ...(places.data?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))]} onChange={(v) => set({ district_id: v === '' ? undefined : Number(v), upazila_id: undefined })} />
          </div>
          <div className="fl-field">
            <span>{tx('তারিখ (থেকে)')}</span>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} />
          </div>
          <div className="fl-field">
            <span>{tx('তারিখ (পর্যন্ত)')}</span>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} />
          </div>
          <div className="fl-filter-btns">
            <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
              {tx('খুঁজুন')}
            </Button>
            <Button onClick={reset}>{tx('রিসেট')}</Button>
          </div>
        </div>

        <div className="lrp-charts">
          <section className="fl-card lrp-chart">
            <h3>{tx('ধরনভিত্তিক জমি (একর)')}</h3>
            <TypeBars parts={s?.by_type ?? []} colorOf={typeColor} />
          </section>
          <section className="fl-card lrp-chart">
            <h3>{tx('মালিকানার বণ্টন')}</h3>
            <Donut parts={s?.ownership ?? []} colors={(p) => OWNERSHIP[p.key ?? ''] ?? '#8a93a3'} total={s?.area_decimal ?? 0} />
          </section>
          <section className="fl-card lrp-chart">
            <h3>{tx('চাষাবাদের অবস্থা')}</h3>
            <Donut parts={s?.by_status ?? []} colors={(p) => STATUS[p.key ?? ''] ?? '#8a93a3'} total={s?.area_decimal ?? 0} />
          </section>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head ml-table-head">
            <h3>{tx('জমির রিপোর্টের তালিকা')}</h3>
            <div className="vl-tools">
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{ items: types.map((t) => ({ key: t.value, label: t.title, onClick: () => run(t.key, { mouza_id: filters.mouza_id, from: filters.from, to: filters.to }, 'xlsx') })) }}
              >
                <Button icon={<AppstoreFilled />} className="ml-columns pl-columns" loading={busy}>
                  {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
                </Button>
              </Dropdown>
              <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
                {tx('প্রিন্ট')}
              </Button>
            </div>
          </div>
          <Table<Generated>
            className="fl-table ml-table pl-table lrp-table"
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.data ?? []}
            pagination={false}
            scroll={{ x: 'max-content' }}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            columns={columns}
            locale={{ emptyText: tx('এখনো কোনো রিপোর্ট তৈরি হয়নি — "রিপোর্ট তৈরি করুন" চাপুন') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) })}</span>
            <span className="ml-pager">
              <Button className="ml-edge" icon={<DoubleLeftOutlined />} disabled={page <= 1} aria-label={tx('প্রথম পাতা')} onClick={() => setPage(1)} />
              <Pagination className="fl-pager" current={page} pageSize={perPage} total={total} showSizeChanger={false} showLessItems itemRender={(p, type, el) => (type === 'page' ? <a>{digits(p)}</a> : el)} onChange={setPage} />
              <Button className="ml-edge" icon={<DoubleRightOutlined />} disabled={page >= lastPage} aria-label={tx('শেষ পাতা')} onClick={() => setPage(lastPage)} />
            </span>
            <span className="fl-rows">
              {tx('প্রতি পাতায় সারি')}{' '}
              <Select
                value={perPage}
                className="fl-size"
                options={[10, 25, 50].map((v) => ({ value: v, label: digits(v) }))}
                onChange={(n) => {
                  setPerPage(n)
                  setPage(1)
                }}
              />
            </span>
          </div>
        </div>

        <Modal
          open={generating}
          title={tx('রিপোর্ট তৈরি করুন')}
          onCancel={() => setGenerating(false)}
          onOk={generate}
          okText={tx('তৈরি করুন')}
          cancelText={tx('বাতিল')}
          confirmLoading={busy}
          destroyOnHidden
        >
          <Form form={form} layout="vertical" preserve={false} initialValues={{ type: 'summary', format: 'print' }}>
            <Form.Item name="type" label={tx('রিপোর্টের ধরন')} rules={[{ required: true }]}>
              <Select options={types.map((t) => ({ value: t.value, label: t.title }))} />
            </Form.Item>
            <Form.Item name="mouza_id" label={tx('মৌজা')}>
              <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder={tx('সব মৌজা')} options={(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))} />
            </Form.Item>
            <Form.Item name="period" label={tx('সময়কাল')} extra={tx('হস্তান্তর ও সেচ রিপোর্টে সময়কাল কাজে লাগে।')}>
              <DatePicker.RangePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="format" label={tx('ফাইল')}>
              <Radio.Group
                options={[
                  { value: 'print', label: tx('প্রিন্ট / PDF') },
                  { value: 'xlsx', label: 'Excel' },
                  { value: 'csv', label: 'CSV' },
                ]}
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal open={!!viewing} width={1100} footer={null} title={viewing?.title} onCancel={() => setViewing(null)} destroyOnHidden>
          {viewing && <ReportView reportKey={viewing.report_key} initial={viewing.filters as Record<string, string | number | undefined>} />}
        </Modal>
      </div>
    </ConfigProvider>
  )
}

