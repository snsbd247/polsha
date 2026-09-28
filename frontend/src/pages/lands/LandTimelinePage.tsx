import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, ConfigProvider, DatePicker, Pagination, Select, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CalendarOutlined,
  EditOutlined,
  EyeFilled,
  FileAddFilled,
  FileTextOutlined,
  HomeOutlined,
  RightOutlined,
  SearchOutlined,
  SolutionOutlined,
  StopOutlined,
  SwapOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useLandMeta, type LandRow } from '../../lib/land'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { PlotSketch } from './LandDetailPage'
import { acres } from './ListFrame'
import '../farmers/farmer-list.css'
import './land-list.css'
import './land-history.css'
import './land-timeline.css'

type Land = LandRow & { location: string; latitude: number | null; longitude: number | null }
type Person = { id: number; name_bn: string; name_en: string | null; role: string | null }
type Row = { key: string; kind: string; date: string; source_id: number; ref: string; title: string; facts: { label: string; value: string }[]; by: Person | null }
type Summary = { kinds: Record<string, string>; users: { id: number; name_bn: string; name_en: string | null }[] }
type Filters = { kind?: string; user_id?: number; from?: string; to?: string }

// colour (tag class, dot colour) and icon for each kind of event, as in the approved design
const KIND: Record<string, [string, string, ReactNode]> = {
  land_created: ['ll-blue', '#1769e0', <FileAddFilled />],
  ownership_added: ['ll-green', '#1f9d55', <TeamOutlined />],
  cultivation_added: ['ll-orange', '#f08c00', <UserAddOutlined />],
  cultivation_updated: ['ll-orange', '#f08c00', <UserSwitchOutlined />],
  borga_agreement: ['ll-purple', '#8b3fe0', <SolutionOutlined />],
  borga_ended: ['ll-purple', '#8b3fe0', <StopOutlined />],
  transfer: ['hs-red', '#e5383b', <SwapOutlined />],
  irrigation: ['hs-teal', '#0e9f9a', <DashIcon name="drop" size={14} color="currentColor" stroke={2.4} />],
  details_updated: ['ll-gray', '#6b7280', <EditOutlined />],
  document_added: ['ll-gray', '#6b7280', <FileTextOutlined />],
}

const TABS: { key: string; label: string; kinds?: string }[] = [
  { key: 'all', label: tx('সব ইতিহাস') },
  { key: 'ownership', label: tx('মালিকানার ইতিহাস'), kinds: 'land_created,ownership_added,transfer' },
  { key: 'cultivation', label: tx('চাষের ইতিহাস'), kinds: 'cultivation_added,cultivation_updated' },
  { key: 'borga', label: tx('বর্গা চাষের ইতিহাস'), kinds: 'borga_agreement,borga_ended' },
  { key: 'transfer', label: tx('হস্তান্তরের ইতিহাস'), kinds: 'transfer' },
  { key: 'irrigation', label: tx('সেচের ইতিহাস'), kinds: 'irrigation' },
  { key: 'document', label: tx('ডকুমেন্টের ইতিহাস'), kinds: 'document_added' },
]

/** One plot's whole story — created, owners, cultivators, borga, transfers, irrigation, documents and edits — oldest first. */
export default function LandTimelinePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: meta } = useLandMeta()
  const [tab, setTab] = useState('all')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'asc' | 'desc'>('asc')
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const kinds = filters.kind ?? TABS.find((t) => t.key === tab)?.kinds
  const params = { land_id: id, full: 1, sort, page, per_page: 20, ...filters, kind: kinds }

  const land = useQuery({ queryKey: ['lands', id], queryFn: async () => (await api.get<Land>(`/lands/${id}`)).data })
  const { data, isFetching } = useQuery({
    queryKey: ['land-activities', 'land', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/activities', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-activities', 'summary', id], queryFn: async () => (await api.get<Summary>('/land-register/activities/summary', { params: { land_id: id } })).data })

  const l = land.data
  const from = data?.total ? (page - 1) * 20 + 1 : 0
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
  const open = (r: Row) =>
    r.kind === 'transfer' ? navigate(`/lands/transfers/${r.source_id}`) : r.kind === 'irrigation' ? navigate(`/irrigation/invoices/${r.source_id}`) : navigate(`/lands/${id}`)

  const columns: ColumnsType<Row> = [
    {
      key: 'dot',
      title: <span className="tl-head-dot" />,
      width: 34,
      className: 'tl-dot-cell',
      render: (_, r) => <span className="tl-dot" style={{ ['--dot' as string]: KIND[r.kind]?.[1] ?? '#6b7280' }} />,
    },
    { key: 'sl', title: '#', width: 40, render: (_, __, i) => digits(from + i) },
    {
      key: 'date',
      title: (
        <button type="button" className="tl-sort" onClick={() => setSort((s) => (s === 'asc' ? 'desc' : 'asc'))}>
          {tx('তারিখ')} <span className={`tl-caret tl-caret-${sort}`} />
        </button>
      ),
      dataIndex: 'date',
      width: 120,
      render: (v: string) => fmtDate(v.slice(0, 10)),
    },
    {
      key: 'kind',
      title: tx('কার্যক্রমের ধরন'),
      width: 220,
      render: (_, r) => (
        <span className="tl-kind">
          <span className={`tl-kind-icon ${KIND[r.kind]?.[0] ?? 'll-gray'}`}>{KIND[r.kind]?.[2]}</span>
          <Tag className={`fl-tag ${KIND[r.kind]?.[0] ?? 'll-gray'}`}>{summary.data?.kinds[r.kind] ?? r.kind}</Tag>
        </span>
      ),
    },
    {
      key: 'detail',
      title: tx('বিস্তারিত'),
      render: (_, r) => (
        <div className="tl-detail">
          <div>{digits(r.title)}</div>
          {r.facts.length > 0 && (
            <ul>
              {r.facts.map((f) => (
                <li key={f.label}>
                  {f.label}: {digits(f.value.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d)))}
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      key: 'by',
      title: tx('সম্পাদনকারী'),
      width: 200,
      render: (_, r) =>
        r.by ? (
          <span className="hs-two tl-by">
            {r.by.role ?? nameOf(r.by)}
            {r.by.role && <span>{nameOf(r.by)}</span>}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'ref', title: tx('রেফারেন্স নং'), dataIndex: 'ref', width: 170, render: (v: string) => digits(v) },
    { key: 'act', title: tx('অ্যাকশন'), width: 84, align: 'center', render: (_, r) => <Button className="tl-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => open(r)} /> },
  ]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl tl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/lands">{tx('জমি ব্যবস্থাপনা')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/lands/lookup/history">{tx('জমির ইতিহাস')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{l?.land_code ?? '…'}</span>
        </nav>
        <div className="fl-head">
          <div>
            <h1>{tx('জমির ইতিহাস')}</h1>
            <p>{tx('একটি জমির মালিকানা, চাষাবাদ, বর্গা, হস্তান্তর ও অন্যান্য কার্যক্রমের পূর্ণ ইতিহাস দেখুন।')}</p>
          </div>
        </div>

        <section className="tl-land">
          {!l ? (
            <Spin />
          ) : (
            <>
              <span className="tl-land-icon">
                <DashIcon name="sprout" size={34} color="#1f9d55" stroke={2} />
              </span>
              <div className="tl-land-code">
                <small>{tx('জমির নং')}</small>
                <strong>{l.land_code}</strong>
                <Tag className="fl-tag fl-tag-green">{meta?.statuses[l.status] ?? l.status}</Tag>
              </div>
              <dl className="tl-kv">
                <dt>{tx('মৌজা')}</dt>
                <dd>{l.mouza ?? '—'}</dd>
                <dt>{tx('দাগ নং')}</dt>
                <dd>{digits(l.dag_no)}</dd>
                <dt>{tx('খতিয়ান নং')}</dt>
                <dd>{digits(l.khatian_no)}</dd>
              </dl>
              <dl className="tl-kv">
                <dt>{tx('জমির ধরন')}</dt>
                <dd>{l.land_type ? <Tag className="fl-tag ll-green">{l.land_type}</Tag> : '—'}</dd>
                <dt>{tx('মোট পরিমাণ')}</dt>
                <dd>
                  {acres(l.area_decimal)} {tx('একর')} ({digits(Math.round(l.area_decimal * 435.6).toLocaleString('en-IN'))} {tx('বর্গফুট')})
                </dd>
                <dt>{tx('অবস্থান')}</dt>
                <dd>{l.location || '—'}</dd>
              </dl>
              <div className="tl-map">
                <PlotSketch land={l} />
              </div>
            </>
          )}
        </section>

        <div className="tl-card">
          <div className="tl-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'on' : ''}
                onClick={() => {
                  setTab(t.key)
                  setPage(1)
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tl-filters">
            <DatePicker prefix={<CalendarOutlined />} format="DD-MM-YYYY" placeholder={tx('তারিখ (থেকে)')} value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} />
            <DatePicker prefix={<CalendarOutlined />} format="DD-MM-YYYY" placeholder={tx('তারিখ (পর্যন্ত)')} value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} />
            <label>
              <span>{tx('কার্যক্রমের ধরন')}</span>
              <Select
                value={draft.kind ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(summary.data?.kinds ?? {}).map(([value, label]) => ({ value, label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, kind: v || undefined }))}
              />
            </label>
            <label>
              <span>{tx('সম্পাদনকারী')}</span>
              <Select
                value={draft.user_id ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...(summary.data?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
                onChange={(v) => setDraft((d) => ({ ...d, user_id: v === '' ? undefined : Number(v) }))}
              />
            </label>
            <div className="tl-filter-btns">
              <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
                {tx('খুঁজুন')}
              </Button>
              <Button onClick={reset}>{tx('রিসেট')}</Button>
            </div>
          </div>

          <Table<Row>
            className="fl-table tl-table"
            rowKey="key"
            loading={isFetching}
            dataSource={data?.data ?? []}
            columns={columns}
            pagination={false}
            scroll={{ x: 1100 }}
            locale={{ emptyText: tx('কোনো কার্যক্রম পাওয়া যায়নি') }}
          />
          {(data?.total ?? 0) > 20 && (
            <div className="tl-pager">
              <Pagination current={page} pageSize={20} total={data?.total ?? 0} showSizeChanger={false} onChange={setPage} itemRender={(p, type, el) => (type === 'page' ? <a>{digits(p)}</a> : el)} />
            </div>
          )}
        </div>
      </div>
    </ConfigProvider>
  )
}
