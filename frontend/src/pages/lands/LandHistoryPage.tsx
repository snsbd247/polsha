import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DatePicker, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from './ListFrame'

type Named = { id: number; name_bn: string; name_en: string | null } | null
type Row = {
  id: number
  created_at: string
  action: string
  type: string
  description: string | null
  user: Named
  land_id: number | null
  land_code: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
}
type Summary = { total: number; today: number; this_month: number; transfers: number; actions: string[]; users: NonNullable<Named>[] }
type Filters = { search?: string; action?: string; user_id?: number; from?: string; to?: string }

const ACTION: Record<string, [string, string]> = {
  create: [tx('তৈরি'), 'fl-tag-green'],
  update: [tx('সম্পাদনা'), 'lp-tag-blue bg-blue'],
  delete: [tx('মুছে ফেলা'), 'fl-tag-red'],
  restore: [tx('পুনরুদ্ধার'), 'fl-tag-green'],
  ownership_transfer: [tx('মালিকানা হস্তান্তর'), 'fl-tag-gold'],
  cultivation_change: [tx('চাষি পরিবর্তন'), 'fl-tag-orange'],
  cultivation_end: [tx('চাষ শেষ'), 'ml-tag-gray'],
}
const TYPE: Record<string, string> = { Land: tx('জমি'), LandDocument: tx('ডকুমেন্ট'), LandNote: tx('নোট') }
const HIDDEN = new Set(['id', 'created_by', 'import_batch_id', 'updated_at', 'created_at', 'path'])

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? Object.values(x).join(' ') : String(x))).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return digits(String(v))
}

const FIELD: Record<string, string> = {
  land_code: tx('জমির নং'),
  khatian_no: tx('খতিয়ান'),
  dag_no: tx('দাগ'),
  area_decimal: tx('পরিমাণ (শতক)'),
  survey: tx('জরিপ'),
  status: tx('অবস্থা'),
  remarks: tx('মন্তব্য'),
  owners: tx('মালিক'),
  effective_date: tx('কার্যকর তারিখ'),
  note: tx('নোট'),
  title: tx('নাম'),
  type: tx('ধরন'),
  original_name: tx('ফাইল'),
}

/** What changed: one line per field, old → new; a new plot is summed up in one line. */
function Changes({ r }: { r: Row }) {
  const v = r.new_values ?? {}
  if (r.action === 'create' && r.type === 'Land') {
    return (
      <span>
        {tx('নতুন জমি')} — {tx('খতিয়ান')} {show(v.khatian_no)} · {tx('দাগ')} {show(v.dag_no)} · {show(v.area_decimal)} {tx('শতক')}
      </span>
    )
  }
  const all = [...new Set([...Object.keys(r.old_values ?? {}), ...Object.keys(r.new_values ?? {})])].filter((k) => !HIDDEN.has(k))
  // bare ids (mouza_id, land_type_id…) mean little on their own; show them only when nothing else changed
  const named = all.filter((k) => !k.endsWith('_id'))
  const keys = named.length ? named : all
  if (!keys.length) return <span className="hs-muted">{r.description || '—'}</span>
  return (
    <ul className="hs-changes">
      {keys.slice(0, 4).map((k) => (
        <li key={k}>
          <b>{FIELD[k] ?? k}</b>: {r.old_values && k in r.old_values && <span className="diff-old">{show(r.old_values[k])}</span>}
          {r.old_values && k in r.old_values && r.new_values && k in r.new_values && ' → '}
          {r.new_values && k in r.new_values && <span className="diff-new">{show(r.new_values[k])}</span>}
        </li>
      ))}
      {keys.length > 4 && <li className="hs-muted">{tx('আরও {{p0}}টি ঘর', { p0: digits(keys.length - 4) })}</li>}
    </ul>
  )
}

/** Every change to land records across all plots, newest first. */
export default function LandHistoryPage() {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['land-history', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/land-register/history', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['land-history', 'summary'], queryFn: async () => (await api.get<Summary>('/land-register/history/summary')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const apply = () => {
    setFilters({ ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(0, 8) + '01'

  const cards = [
    { key: 'total', label: tx('মোট পরিবর্তন'), value: s?.total, icon: 'file', color: '#2563eb', tint: '#e4edfd', onClick: () => { setFilters({}); setDraft({}); setRange(null); setPage(1) } },
    { key: 'today', label: tx('আজকের পরিবর্তন'), value: s?.today, icon: 'calendar', color: '#1f9d55', tint: '#e3f5ea', onClick: () => { setFilters({ from: today }); setPage(1) } },
    { key: 'month', label: tx('এ মাসের পরিবর্তন'), value: s?.this_month, icon: 'bars', color: '#f08c00', tint: '#fdf0dc', onClick: () => { setFilters({ from: month }); setPage(1) } },
    { key: 'transfers', label: tx('মালিকানা হস্তান্তর'), value: s?.transfers, icon: 'share', color: '#6d4ae6', tint: '#ece7fc', onClick: () => { setFilters({ action: 'ownership_transfer' }); setPage(1) } },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'created_at', width: 150, render: fmtDateTime },
    { title: tx('জমির নং'), dataIndex: 'land_code', width: 100, render: (v, r) => (v && r.land_id ? <Link to={`/lands/${r.land_id}?tab=history`} className="fl-link">{v}</Link> : '—') },
    { title: tx('রেকর্ড'), dataIndex: 'type', width: 90, render: (v) => TYPE[v] ?? v },
    { title: tx('কাজ'), dataIndex: 'action', width: 140, render: (a) => <Tag className={`fl-tag ${ACTION[a]?.[1] ?? 'ml-tag-gray'}`}>{ACTION[a]?.[0] ?? a}</Tag> },
    { title: tx('পরিবর্তন'), render: (_, r) => <Changes r={r} /> },
    { title: tx('করেছেন'), dataIndex: 'user', width: 160, render: (u: Named) => nameOf(u) || '—' },
  ]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমির ইতিহাস')}
      subtitle={tx('সব জমির রেকর্ডে কে, কবে, কী পরিবর্তন করেছেন — জমি তৈরি, সম্পাদনা, মালিকানা ও চাষি বদল, ডকুমেন্ট ও নোট।')}
      cards={cards}
      filters={
        <>
          <Field grow={260}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('জমির নং বা দাগ নং...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('কাজ')}>
            <Select
              value={draft.action ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.actions ?? []).map((a) => ({ value: a, label: ACTION[a]?.[0] ?? a }))]}
              onChange={(v) => setDraft((d) => ({ ...d, action: v || undefined }))}
            />
          </Field>
          <Field label={tx('করেছেন')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.user_id ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...(s?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, user_id: v === '' ? undefined : Number(v) }))}
            />
          </Field>
          <Field label={tx('তারিখের পরিসর')} grow={220}>
            <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => {
        setDraft({})
        setRange(null)
        setFilters({})
        setPage(1)
      }}
      tableTitle={tx('পরিবর্তনের তালিকা ({{p0}})', { p0: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Row>
        className="fl-table ml-table pl-table hs-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 1100 }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো পরিবর্তন পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
