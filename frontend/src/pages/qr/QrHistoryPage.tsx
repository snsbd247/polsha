import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, CheckOutlined, CloseOutlined, QrcodeOutlined, ScanOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import './qr.css'

type Row = {
  id: number
  entity_type: string
  entity_id: number | null
  code: string
  label: string | null
  found: boolean
  source: string
  ip: string | null
  created_at: string
  user: { id: number; name_bn: string; name_en: string | null; username: string } | null
}
type Resp = Paginated<Row> & { types: Record<string, string>; can_all: boolean; counts: { total: number; found: number; missing: number; today: number } }
type Filters = { entity_type?: string; source?: string; found?: string; from?: string; to?: string; search?: string }

const SOURCE_LABEL: Record<string, string> = { camera: tx('ক্যামেরা'), manual: tx('হাতে লেখা'), link: tx('লিংক') }

/** Every QR code scanned (mine, or everyone's for auditors): what it pointed to and whether it was found. */
export default function QrHistoryPage() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [everyone, setEveryone] = useState(false)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const params = { page, per_page: perPage, all: everyone ? 1 : undefined, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['qr-history', params],
    queryFn: async () => (await api.get<Resp>('/qr/history', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
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
  const today = dayjs().format('YYYY-MM-DD')
  const all = [{ value: '', label: tx('সকল') }]
  const target = (r: Row) => {
    if (!r.found || !r.entity_id) return r.label || '—'
    if (r.entity_type === 'asset') return <Link to={`/assets/${r.entity_id}`}>{r.label}</Link>
    if (r.entity_type === 'receipt' || r.entity_type === 'combined') return <Link to={`/verify/${r.entity_type}/${r.code}`}>{r.label}</Link>
    return <Link to={`/q/${r.entity_type}/${encodeURIComponent(r.code)}`}>{r.label}</Link>
  }

  const cards = [
    { key: 'total', label: tx('মোট স্ক্যান'), value: c?.total, icon: '', glyph: <QrcodeOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'found', label: tx('পাওয়া গেছে'), value: c?.found, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ found: '1' }) },
    { key: 'missing', label: tx('পাওয়া যায়নি'), value: c?.missing, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ found: '0' }) },
    { key: 'today', label: tx('আজকের স্ক্যান'), value: c?.today, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ from: today, to: today }) },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
    { title: tx('ধরন'), dataIndex: 'entity_type', render: (v: string) => data?.types[v] ?? v },
    { title: tx('কোড'), dataIndex: 'code', render: (v: string) => <span className="fl-link iv-no">{digits(v)}</span> },
    { title: tx('তথ্য'), render: (_, r) => target(r) },
    { title: tx('ফলাফল'), dataIndex: 'found', render: (f: boolean) => (f ? <Tag className="fl-tag fl-tag-green">{tx('পাওয়া গেছে')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('পাওয়া যায়নি')}</Tag>) },
    { title: tx('উৎস'), dataIndex: 'source', render: (v: string) => SOURCE_LABEL[v] ?? v },
    ...(everyone ? [{ title: tx('ইউজার'), render: (_: unknown, r: Row) => nameOf(r.user) || '—' }] : []),
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('QR স্ক্যান ইতিহাস')}
      subtitle=""
      actions={
        <Button type="primary" icon={<ScanOutlined />} onClick={() => navigate('/qr/scan')}>
          {tx('QR স্ক্যানার')}
        </Button>
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={260}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('কোড বা নাম দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('ধরন')}>
            <Select value={draft.entity_type ?? ''} options={[...all, ...Object.entries(data?.types ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ entity_type: v || undefined })} />
          </Field>
          <Field label={tx('উৎস')}>
            <Select value={draft.source ?? ''} options={[...all, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ source: v || undefined })} />
          </Field>
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
      tableTitle={tx('{{p0}} ({{p1}})', { p0: everyone ? tx('সবার স্ক্যান') : tx('আমার স্ক্যান'), p1: n0(total) })}
      tableTools={
        data?.can_all && (
          <span className="qr-everyone">
            <Switch
              size="small"
              checked={everyone}
              onChange={(v) => {
                setEveryone(v)
                setPage(1)
              }}
            />{' '}
            {tx('সবার স্ক্যান')}
          </span>
        )
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
      <Table<Row>
        className="fl-table ml-table pl-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো স্ক্যান নেই') }}
      />
    </ListFrame>
  )
}
