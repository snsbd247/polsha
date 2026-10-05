import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, ConfigProvider, Dropdown, Input, Pagination, Select, Table, type TableColumnsType } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClockCircleFilled,
  DollarOutlined,
  DownloadOutlined,
  DownOutlined,
  EditFilled,
  EyeOutlined,
  FileTextFilled,
  FileTextOutlined,
  HomeOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { feeOf, useWaterMeta, type WaterConnection } from '../../lib/water'
import ConnectionForm from './ConnectionForm'
import './connections.css'

/**
 * Water connections & customers, laid out as the approved design: five summary
 * cards, a filter card, then the list with its toolbar and paging.
 */
type Params = { page: number; per_page: number; search?: string; type_id?: number; village_id?: number; status?: string }
type Summary = {
  total: number
  active: number
  disconnected: number
  closed: number
  new_this_month: number
  owing: number
  due: number
  billed_this_month: number
  billed_last_month: number
}

/** each connection type keeps its own tag colour, in the order the types are listed */
const TYPE_TONES = ['blue', 'purple', 'teal', 'amber']
const COLS_KEY = 'polsha.water.connections.hidden'
const AVATAR_COLORS = ['#1f6fe5', '#7a3ff2', '#e5484d', '#0e9f6e', '#f59e0b', '#0891b2', '#db2777', '#65a30d']

const initials = (name: string) =>
  name
    .replace(/^(মোঃ|মোছাঃ|মোসাঃ|মো\.|Md\.?|Mst\.?)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

const pct = (part: number, whole: number) => (whole > 0 ? `${digits(((part / whole) * 100).toFixed(1))}%` : `${digits('0')}%`)

function readHidden(): string[] {
  try {
    // the monthly fee is not in the design's list; it can be switched on in Column Settings
    return JSON.parse(localStorage.getItem(COLS_KEY) ?? '["fee"]')
  } catch {
    return ['fee']
  }
}

export default function ConnectionsPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Omit<Params, 'page' | 'per_page'>>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>(readHidden)
  const [editing, setEditing] = useState<WaterConnection | null | 'new'>(null)
  const [printing, setPrinting] = useState(false)
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const summary = useQuery({ queryKey: ['water', 'connections-summary'], queryFn: async () => (await api.get<Summary>('/water/connections-summary')).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'connections', params],
    queryFn: async () => (await api.get<Paginated<WaterConnection>>('/water/connections', { params })).data,
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(hidden))
    } catch {
      /* storage unavailable */
    }
  }, [hidden])

  // print after the page has re-rendered with only the ticked rows
  useEffect(() => {
    if (!printing) return
    const id = window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
    return () => window.clearTimeout(id)
  }, [printing])

  const apply = () => setParams((p) => ({ ...p, ...draft, search: draft.search?.trim() || undefined, page: 1 }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const s = summary.data
  const change = s && s.billed_last_month > 0 ? ((s.billed_this_month - s.billed_last_month) / s.billed_last_month) * 100 : null
  const cards: { key: string; icon: ReactNode; value: string; label: string; sub?: ReactNode }[] = [
    { key: 'blue', icon: <TeamOutlined />, value: digits((s?.total ?? 0).toLocaleString('en-IN')), label: tx('মোট গ্রাহক') },
    { key: 'green', icon: <LinkOutlined />, value: digits((s?.active ?? 0).toLocaleString('en-IN')), label: tx('চালু সংযোগ'), sub: tx('মোটের {{p0}}', { p0: pct(s?.active ?? 0, s?.total ?? 0) }) },
    { key: 'red', icon: <DisconnectIcon />, value: digits((s?.disconnected ?? 0).toLocaleString('en-IN')), label: tx('বিচ্ছিন্ন'), sub: tx('মোটের {{p0}}', { p0: pct(s?.disconnected ?? 0, s?.total ?? 0) }) },
    { key: 'orange', icon: <ClockCircleFilled />, value: digits((s?.owing ?? 0).toLocaleString('en-IN')), label: tx('বকেয়া আছে এমন সংযোগ'), sub: tx('মোটের {{p0}}', { p0: pct(s?.owing ?? 0, s?.total ?? 0) }) },
    {
      key: 'purple',
      icon: <FileTextFilled />,
      value: `৳ ${digits(Math.round(s?.billed_this_month ?? 0).toLocaleString('en-IN'))}`,
      label: tx('মোট বিল (এই মাস)'),
      sub:
        change === null ? undefined : (
          <span className={change >= 0 ? 'wcl-up' : 'wcl-down'}>
            {change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {change >= 0 ? '+' : '−'}
            {digits(Math.abs(change).toFixed(1))}% {tx('গত মাস থেকে')}
          </span>
        ),
    },
  ]

  const exportCsv = () =>
    downloadExport('/water/connections', { ...params, page: undefined, per_page: undefined, ids: selected.length ? selected.join(',') : undefined, export: 'csv' }, 'water-connections.csv').catch((e) =>
      message.error(errorMessage(e)),
    )

  const allColumns: (TableColumnsType<WaterConnection>[number] & { key: string; fixedCol?: boolean })[] = [
    {
      key: 'sl',
      title: '#',
      width: 52,
      fixedCol: true,
      render: (_, __, i) => digits((params.page - 1) * params.per_page + i + 1),
    },
    { key: 'customer_id', title: tx('গ্রাহক আইডি'), width: 96, render: (_, r) => (r.farmer ? digits(r.farmer.farmer_code) : <span className="wcl-muted">—</span>) },
    {
      key: 'name',
      title: tx('গ্রাহকের নাম'),
      width: 180,
      fixedCol: true,
      render: (_, r) => {
        const name = nameOf(r)
        return (
          <Link to={`/water/connections/${r.id}`} className="wcl-person">
            <span className="wcl-avatar" style={{ background: AVATAR_COLORS[r.id % AVATAR_COLORS.length] }}>
              {initials(name)}
            </span>
            <span className="wcl-name">{name}</span>
          </Link>
        )
      },
    },
    { key: 'connection_no', title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 112, render: (v: string) => digits(v) },
    { key: 'mobile', title: tx('মোবাইল'), dataIndex: 'mobile', width: 118, render: (v) => (v ? digits(v) : <span className="wcl-muted">—</span>) },
    {
      key: 'area',
      title: tx('এলাকা / ঠিকানা'),
      width: 160,
      render: (_, r) => {
        const area = [r.address, nameOf(r.village)].filter(Boolean).join(', ')
        return area ? <span title={area}>{area}</span> : <span className="wcl-muted">—</span>
      },
    },
    { key: 'fee', title: tx('মাসিক ফি'), width: 95, render: (_, r) => `৳ ${money(feeOf(r))}` },
    {
      key: 'status',
      title: tx('অবস্থা'),
      dataIndex: 'status',
      width: 96,
      render: (st: string) => <span className={`wcl-tag wcl-tag-${st === 'active' ? 'green' : st === 'disconnected' ? 'red' : 'amber'}`}>{meta?.statuses[st] ?? st}</span>,
    },
    {
      key: 'type',
      title: tx('গ্রাহকের ধরন'),
      width: 118,
      render: (_, r) => <span className={`wcl-tag wcl-tag-${TYPE_TONES[Math.max(0, (meta?.types ?? []).findIndex((t) => t.id === r.type_id)) % TYPE_TONES.length]}`}>{nameOf(r.type)}</span>,
    },
    {
      key: 'due',
      title: tx('বকেয়া'),
      dataIndex: 'due',
      width: 100,
      align: 'right',
      render: (v) => (Number(v) > 0 ? <strong className="wcl-due">৳ {money(v)}</strong> : <span className="wcl-muted">৳ {money(0)}</span>),
    },
    {
      key: 'action',
      title: tx('কাজ'),
      width: 134,
      fixedCol: true,
      className: 'wcl-no-print wcl-actcol',
      render: (_, r) => (
        <span className="wcl-acts">
          <Link to={`/water/connections/${r.id}`} className="wcl-act" aria-label={tx('বিস্তারিত')} title={tx('বিস্তারিত')}>
            <EyeOutlined />
          </Link>
          {can('water.edit') && (
            <button type="button" className="wcl-act wcl-act-edit" aria-label={tx('সম্পাদনা')} title={tx('সম্পাদনা')} onClick={() => setEditing(r)}>
              <EditFilled />
            </button>
          )}
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'view', icon: <EyeOutlined />, label: tx('বিস্তারিত দেখুন'), onClick: () => navigate(`/water/connections/${r.id}`) },
                ...(can('water.create') && Number(r.due) > 0
                  ? [{ key: 'collect', icon: <DollarOutlined />, label: tx('বিল আদায় করুন'), onClick: () => navigate(`/water/collect?connection=${r.id}`) }]
                  : []),
                { key: 'bills', icon: <FileTextOutlined />, label: tx('বিল ও পরিশোধ'), onClick: () => navigate(`/water/connections/${r.id}`) },
              ],
            }}
          >
            <button type="button" className="wcl-act" aria-label={tx('আরও')}>
              <MoreOutlined />
            </button>
          </Dropdown>
        </span>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !c.fixedCol)
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  const rows = useMemo(() => {
    const all = data?.data ?? []
    return printing && selected.length ? all.filter((r) => selected.includes(r.id)) : all
  }, [data, printing, selected])
  const total = data?.total ?? 0
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0', borderRadius: 6 } }}>
      <div className="wcl">
        <nav className="wcl-crumb wcl-no-print">
          <Link to="/">
            <HomeOutlined /> {tx('হোম')}
          </Link>
          <RightOutlined className="wcl-sep" />
          <span>{tx('পানি সরবরাহ')}</span>
          <RightOutlined className="wcl-sep" />
          <b>{tx('সংযোগ ও গ্রাহক')}</b>
        </nav>

        <div className="wcl-cards wcl-no-print">
          {cards.map((c) => (
            <div key={c.key} className={`wcl-card wcl-card-${c.key}`}>
              <span className="wcl-card-ic">{c.icon}</span>
              <span className="wcl-card-body">
                <b>{c.value}</b>
                <span>{c.label}</span>
                {c.sub && <small>{c.sub}</small>}
              </span>
            </div>
          ))}
        </div>

        <div className="wcl-filters wcl-no-print">
          <label className="wcl-field wcl-field-search">
            <span>{tx('খুঁজুন')}</span>
            <Input
              prefix={<SearchOutlined />}
              placeholder={tx('নাম, মোবাইল, সংযোগ নং, গ্রাহক আইডি, ঠিকানা...')}
              allowClear
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
              onPressEnter={apply}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('সংযোগের অবস্থা')}</span>
            <Select
              value={draft.status ?? ''}
              options={[{ value: '', label: tx('সব অবস্থা') }, ...Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('গ্রাহকের ধরন')}</span>
            <Select
              value={draft.type_id ?? 0}
              options={[{ value: 0, label: tx('সব ধরন') }, ...(meta?.types ?? []).map((t) => ({ value: t.id, label: nameOf(t) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, type_id: v || undefined }))}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('এলাকা / গ্রাম')}</span>
            <Select
              value={draft.village_id ?? 0}
              showSearch={{ optionFilterProp: 'label' }}
              options={[{ value: 0, label: tx('সব এলাকা') }, ...(villages.data ?? []).map((v) => ({ value: v.id, label: nameOf(v) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, village_id: v || undefined }))}
            />
          </label>
          <div className="wcl-filter-btns">
            <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
              {tx('খুঁজুন')}
            </Button>
            <Button className="wcl-reset" onClick={reset}>
              {tx('রিসেট')}
            </Button>
          </div>
        </div>

        <div className="wcl-list">
          <div className="wcl-tools wcl-no-print">
            {can('water.create') && (
              <Button type="primary" icon={<PlusOutlined />} className="wcl-add" onClick={() => setEditing('new')}>
                {tx('নতুন সংযোগ যোগ করুন')}
              </Button>
            )}
            {can('import.create') && (
              <Button icon={<UploadOutlined />} onClick={() => navigate('/imports/water-connections')}>
                {tx('ইমপোর্ট')}
              </Button>
            )}
            <span className="wcl-tools-gap" />
            {selected.length > 0 && <span className="wcl-picked">{tx('{{p0}}টি বাছাই করা', { p0: digits(selected.length) })}</span>}
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  { key: 'csv', icon: <DownloadOutlined />, label: selected.length ? tx('বাছাই করা সারি — CSV (Excel)') : tx('সব সারি — CSV (Excel)'), onClick: exportCsv },
                ],
              }}
            >
              <Button icon={<DownloadOutlined />}>
                {tx('এক্সপোর্ট')} <DownOutlined className="wcl-caret" />
              </Button>
            </Dropdown>
            <Button icon={<PrinterOutlined />} onClick={() => setPrinting(true)}>
              {tx('প্রিন্ট')}
            </Button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              popupRender={() => (
                <div className="wcl-colmenu">
                  {hideable.map((c) => (
                    <Checkbox key={c.key} checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                      {c.title as string}
                    </Checkbox>
                  ))}
                </div>
              )}
            >
              <Button icon={<SettingOutlined />}>{tx('কলাম সেটিংস')}</Button>
            </Dropdown>
          </div>

          <Table<WaterConnection>
            className="wcl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            tableLayout="fixed"
            scroll={{ x: 1210 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 44, preserveSelectedRowKeys: true }}
            columns={columns}
          />

          <div className="wcl-foot wcl-no-print">
            <span>{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: digits(from), p1: digits(to), p2: digits(total.toLocaleString('en-IN')) })}</span>
            <span className="wcl-foot-end">
              <Pagination
                className="wcl-pager"
                current={params.page}
                pageSize={params.per_page}
                total={total}
                showSizeChanger={false}
                showLessItems
                itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
                onChange={(page) => setParams((p) => ({ ...p, page }))}
              />
              <Select
                className="wcl-size"
                value={params.per_page}
                options={[10, 25, 50, 100].map((n) => ({ value: n, label: tx('{{p0}} / পাতা', { p0: digits(n) }) }))}
                onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))}
              />
            </span>
          </div>
        </div>

        <ConnectionForm
          open={editing !== null}
          connection={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            const added = editing === 'new'
            setEditing(null)
            if (added) navigate(`/water/connections/${c.id}`)
          }}
        />
      </div>
    </ConfigProvider>
  )
}

/** Water drop crossed out — the design's "disconnected" mark. */
function DisconnectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3s-6 7-6 11a6 6 0 0 0 10.2 4.3M17.6 14.6C17.9 14.4 18 14.2 18 14c0-4-6-11-6-11" />
      <path d="M4 4l16 16" />
    </svg>
  )
}
