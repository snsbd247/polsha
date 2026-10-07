import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { App, Dropdown, Input, InputNumber, Select, Table, type TableColumnsType } from 'antd'
import { DisconnectOutlined, DollarOutlined, EyeOutlined, FileTextFilled, FilterFilled, MoreOutlined, SearchOutlined, TeamOutlined, WalletFilled, WarningFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { useWaterMeta, type WaterConnection } from '../../lib/water'
import { Field, FilterCard, ListCard, num, pct, SummaryCards, useHiddenColumns, usePrint, WaterFrame } from './WaterList'

/** Who owes what, connection by connection — biggest first; "N bills or more" finds the ones to disconnect. */
type Row = WaterConnection & { open_bills: number; oldest_bill: string | null }
type Totals = { connections: number; due: number; bills: number; long_due: number; disconnected: number }
type Params = { page: number; per_page: number; search?: string; type_id?: number; village_id?: number; status?: string; min_bills?: number }

const AVATAR_COLORS = ['#1f6fe5', '#7a3ff2', '#e5484d', '#0e9f6e', '#f59e0b', '#0891b2', '#db2777', '#65a30d']
const TYPE_TONES = ['blue', 'purple', 'teal', 'amber']
const longDate = (d?: string | null) => (d ? digits(dayjs(d).format('DD MMM YYYY')) : '—')
const initials = (name: string) =>
  name
    .replace(/^(মোঃ|মোছাঃ|মোসাঃ|মো\.|Md\.?|Mst\.?)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export default function DuesPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10 })
  const [draft, setDraft] = useState<Omit<Params, 'page' | 'per_page'>>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useHiddenColumns('polsha.water.dues.hidden', [])
  const [printing, print] = usePrint()
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'due-list', params],
    queryFn: async () => (await api.get<Paginated<Row> & { totals: Totals }>('/water/dues', { params })).data,
    placeholderData: keepPreviousData,
  })

  const apply = () => setParams((p) => ({ ...p, ...draft, search: draft.search?.trim() || undefined, page: 1 }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const t = data?.totals
  const cards = [
    { key: 'conn', tone: 'blue' as const, icon: <TeamOutlined />, label: tx('বকেয়াদার সংযোগ'), value: num(t?.connections), sub: tx('অন্তত একটি বিল বাকি') },
    { key: 'bills', tone: 'orange' as const, icon: <FileTextFilled />, label: tx('বকেয়া বিল'), value: num(t?.bills), sub: tx('অপরিশোধিত ও আংশিক') },
    { key: 'due', tone: 'red' as const, icon: <WalletFilled />, label: tx('মোট বকেয়া'), value: `৳ ${num(t?.due)}`, sub: tx('জরিমানাসহ') },
    { key: 'long', tone: 'purple' as const, icon: <WarningFilled />, label: tx('৩ মাস বা বেশি বাকি'), value: num(t?.long_due), sub: tx('বকেয়াদারের {{p0}}', { p0: pct(t?.long_due ?? 0, t?.connections ?? 0) }) },
    { key: 'disc', tone: 'green' as const, icon: <DisconnectOutlined />, label: tx('বিচ্ছিন্ন সংযোগ'), value: num(t?.disconnected), sub: tx('বকেয়া নিয়ে বিচ্ছিন্ন') },
  ]

  const allColumns: (TableColumnsType<Row>[number] & { key: string; fixedCol?: boolean })[] = [
    { key: 'sl', title: '#', width: 48, fixedCol: true, render: (_, __, i) => digits((params.page - 1) * params.per_page + i + 1) },
    {
      key: 'name',
      title: tx('গ্রাহকের নাম'),
      width: 170,
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
    { key: 'connection_no', title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 110, render: (v: string) => digits(v) },
    { key: 'mobile', title: tx('মোবাইল'), dataIndex: 'mobile', width: 112, render: (v) => (v ? digits(v) : <span className="wcl-muted">—</span>) },
    { key: 'village', title: tx('এলাকা / গ্রাম'), width: 95, render: (_, r) => nameOf(r.village) || <span className="wcl-muted">—</span> },
    {
      key: 'type',
      title: tx('গ্রাহকের ধরন'),
      width: 118,
      render: (_, r) => <span className={`wcl-tag wcl-tag-${TYPE_TONES[Math.max(0, (meta?.types ?? []).findIndex((x) => x.id === r.type_id)) % TYPE_TONES.length]}`}>{nameOf(r.type)}</span>,
    },
    {
      key: 'status',
      title: tx('অবস্থা'),
      dataIndex: 'status',
      width: 92,
      render: (s: string) => <span className={`wcl-tag wcl-tag-${s === 'active' ? 'green' : s === 'disconnected' ? 'red' : 'amber'}`}>{meta?.statuses[s] ?? s}</span>,
    },
    {
      key: 'open_bills',
      title: tx('বকেয়া বিল'),
      dataIndex: 'open_bills',
      width: 90,
      align: 'center',
      render: (v: number) => <span className={`wcl-count ${v >= 3 ? 'wcl-count-hot' : ''}`}>{digits(v)}</span>,
    },
    { key: 'oldest', title: tx('সবচেয়ে পুরনো'), dataIndex: 'oldest_bill', width: 104, render: longDate },
    { key: 'due', title: tx('বকেয়া (৳)'), dataIndex: 'due', width: 100, align: 'right', render: (v) => <strong className="wcl-due">{money(v)}</strong> },
    {
      key: 'action',
      title: tx('কাজ'),
      width: 132,
      fixedCol: true,
      className: 'wcl-no-print wcl-actcol',
      render: (_, r) => (
        <span className="wcl-acts">
          <Link to={`/water/connections/${r.id}`} className="wcl-act" aria-label={tx('বিস্তারিত')} title={tx('বিস্তারিত')}>
            <EyeOutlined />
          </Link>
          <button
            type="button"
            className="wcl-act wcl-act-edit"
            aria-label={tx('টাকা আদায়')}
            title={tx('টাকা আদায়')}
            disabled={!can('water.create')}
            onClick={() => navigate(`/water/collect?connection=${r.id}`)}
          >
            <DollarOutlined />
          </button>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'view', icon: <EyeOutlined />, label: tx('সংযোগের পাতা'), onClick: () => navigate(`/water/connections/${r.id}`) },
                { key: 'bills', icon: <FileTextFilled />, label: tx('এই সংযোগের বিল'), onClick: () => navigate(`/water/bills?search=${encodeURIComponent(r.connection_no)}`) },
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
  const columns = allColumns.filter((col) => !hidden.includes(col.key))
  const rows = useMemo(() => {
    const all = data?.data ?? []
    return printing && selected.length ? all.filter((r) => selected.includes(r.id)) : all
  }, [data, printing, selected])

  return (
    <WaterFrame crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির বিল বকেয়া') }]}>
      <SummaryCards cards={cards} />

      <FilterCard
        className="wcl-filters-5"
        title={
          <>
            <FilterFilled /> {tx('ফিল্টার ও খোঁজ')}
          </>
        }
        onSearch={apply}
        onReset={reset}
      >
        <Field label={tx('খুঁজুন')} wide>
          <Input
            prefix={<SearchOutlined />}
            placeholder={tx('নাম, মোবাইল বা সংযোগ নং...')}
            allowClear
            value={draft.search}
            onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
            onPressEnter={apply}
          />
        </Field>
        <Field label={tx('গ্রাহকের ধরন')}>
          <Select
            value={draft.type_id ?? 0}
            options={[{ value: 0, label: tx('সব ধরন') }, ...(meta?.types ?? []).map((x) => ({ value: x.id, label: nameOf(x) }))]}
            onChange={(v) => setDraft((d) => ({ ...d, type_id: v || undefined }))}
          />
        </Field>
        <Field label={tx('এলাকা / গ্রাম')}>
          <Select
            value={draft.village_id ?? 0}
            showSearch={{ optionFilterProp: 'label' }}
            options={[{ value: 0, label: tx('সব এলাকা') }, ...(villages.data ?? []).map((v) => ({ value: v.id, label: nameOf(v) }))]}
            onChange={(v) => setDraft((d) => ({ ...d, village_id: v || undefined }))}
          />
        </Field>
        <Field label={tx('সংযোগের অবস্থা')}>
          <Select
            value={draft.status ?? ''}
            options={[{ value: '', label: tx('সব অবস্থা') }, ...Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))]}
            onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
          />
        </Field>
        <Field label={tx('কমপক্ষে কয়টি বিল বাকি')}>
          <InputNumber min={1} value={draft.min_bills} placeholder={tx('যেমন ৩')} style={{ width: '100%', height: 40 }} onChange={(v) => setDraft((d) => ({ ...d, min_bills: v ? Number(v) : undefined }))} />
        </Field>
      </FilterCard>

      <ListCard
        title={
          <>
            <WalletFilled /> {tx('বকেয়ার তালিকা')}
          </>
        }
        selectedCount={selected.length}
        onExport={() =>
          downloadExport('/water/dues', { ...params, page: undefined, per_page: undefined, ids: selected.length ? selected.join(',') : undefined, export: 'csv' }, 'water-dues.csv').catch((e) =>
            message.error(errorMessage(e)),
          )
        }
        onPrint={print}
        columns={allColumns.filter((col) => !col.fixedCol).map((col) => ({ key: col.key, title: col.title as ReactNode }))}
        hidden={hidden}
        setHidden={setHidden}
        pager={{
          page: params.page,
          perPage: params.per_page,
          total: data?.total ?? 0,
          onPage: (page) => setParams((p) => ({ ...p, page })),
          onSize: (per_page) => setParams((p) => ({ ...p, per_page, page: 1 })),
        }}
      >
        <Table<Row>
          className="wcl-table"
          rowKey="id"
          loading={isFetching}
          dataSource={rows}
          tableLayout="fixed"
          scroll={{ x: 1180 }}
          pagination={false}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 44, preserveSelectedRowKeys: true }}
          columns={columns}
        />
      </ListCard>
    </WaterFrame>
  )
}
