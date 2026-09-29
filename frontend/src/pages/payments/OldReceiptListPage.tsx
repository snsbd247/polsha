import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, CheckOutlined, EyeFilled, FileTextFilled, PlusOutlined, PrinterOutlined, SearchOutlined, TeamOutlined, DownloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RECEIPT_STATUS_LABEL, useInvoiceMeta } from '../../lib/irrigation'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import '../irrigation/rates.css'

type Row = {
  id: number
  receipt_no: string
  legacy_no: string | null
  date: string
  payer_name: string
  farmer_id: number | null
  mobile: string | null
  amount: number
  status: string
  remarks: string | null
  seasons: string[]
  invoices: { id: number; invoice_no: string }[]
  creator: { name_bn: string; name_en: string | null } | null
}
type Summary = { count: number; amount: number; farmers: number; from: string | null; to: string | null }
type Filters = { search?: string; season_id?: number; mouza_id?: number; from?: string; to?: string }

/** Old hand-written receipts entered into the system, with search and filters. */
export default function OldReceiptListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const { data: meta } = useInvoiceMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const params = { page, per_page: perPage, is_legacy: 1, with_invoices: 1, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['receipts', 'legacy', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/receipts', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['receipts', 'legacy-summary'], queryFn: async () => (await api.get<Summary>('/receipts/legacy-summary')).data })
  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
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
  const exportCsv = () => downloadExport('/receipts', { ...params, page: undefined, per_page: undefined, with_invoices: undefined, export: 'csv' }, 'old-receipts.csv').catch((e) => message.error(errorMessage(e)))

  const cards = [
    { key: 'count', label: tx('মোট রশিদ'), value: s?.count, icon: '', glyph: <FileTextFilled />, color: '#8b3fe0', tint: '#efe4fc', onClick: reset },
    { key: 'amount', label: tx('মোট টাকা'), value: s ? `৳ ${money(s.amount)}` : undefined, icon: '', glyph: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'farmers', label: tx('আলাদা কৃষক'), value: s?.farmers, icon: '', glyph: <TeamOutlined />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'range', label: tx('তারিখের পরিসর'), value: s?.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : '—', icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('রশিদ নং'), dataIndex: 'legacy_no', render: (v: string | null, r) => <Link to={`/payments/receipts/${r.id}`} className="fl-link">{digits(v ?? r.receipt_no)}</Link> },
    { title: tx('রশিদের তারিখ'), dataIndex: 'date', render: fmtDate },
    { title: tx('কৃষকের নাম'), dataIndex: 'payer_name', render: (v, r) => (r.farmer_id ? <Link to={`/farmers/${r.farmer_id}`} className="mg-name">{v}</Link> : v) },
    { title: tx('মোবাইল নং'), dataIndex: 'mobile', render: (v) => (v ? digits(v) : '—') },
    { title: tx('মৌসুম'), dataIndex: 'seasons', render: (v: string[]) => v.join(', ') || '—' },
    {
      title: tx('ইনভয়েস নং (যদি থাকে)'),
      dataIndex: 'invoices',
      render: (v: Row['invoices']) =>
        v.length
          ? v.map((i, k) => (
              <span key={i.id}>
                {k > 0 && ', '}
                <Link to={`/irrigation/invoices/${i.id}`} className="or-inv">
                  {digits(i.invoice_no)}
                </Link>
              </span>
            ))
          : '—',
    },
    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
    { title: tx('এন্ট্রি করেছেন'), render: (_, r) => nameOf(r.creator) || '—' },
    { title: tx('মন্তব্য'), dataIndex: 'remarks', className: 'lt-desc', render: (v, r) => (r.status === 'cancelled' ? <Tag className="fl-tag fl-tag-red">{RECEIPT_STATUS_LABEL[r.status] ?? r.status}</Tag> : v || '—') },
    { title: tx('অ্যাকশন'), width: 70, align: 'center', render: (_, r) => <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/payments/receipts/${r.id}`)} /> },
  ]

  return (
    <ListFrame
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('পুরোনো রশিদ এন্ট্রির তালিকা')}
      subtitle={tx('হাতে লেখা পুরোনো সেচের রশিদ যেগুলো সিস্টেমে এন্ট্রি করা হয়েছে, সেগুলো দেখুন ও পরিচালনা করুন।')}
      actions={
        can('payment.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/collect?legacy=1#new')}>
            {tx('নতুন পুরোনো রশিদ এন্ট্রি')}
          </Button>
        )
      }
      cards={cards}
      filterClass="rt-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('রশিদ নং, কৃষকের নাম বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={apply} />
          </Field>
          <Field label={tx('মৌসুম')}>
            <Select value={draft.season_id ?? ''} options={[{ value: '', label: tx('সব মৌসুম') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, season_id: v === '' ? undefined : Number(v) }))} />
          </Field>
          <Field label={tx('মৌজা')}>
            <Select showSearch={{ optionFilterProp: 'label' }} value={draft.mouza_id ?? ''} options={[{ value: '', label: tx('সব মৌজা') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]} onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD/MM/YYYY" placeholder="dd/mm/yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%' }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD/MM/YYYY" placeholder="dd/mm/yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%' }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={reset}
      tableTitle={tx('পুরোনো রশিদ ({{p0}})', { p0: n0(total) })}
      tableTools={
        <>
          <Button icon={<DownloadOutlined />} className="ml-columns pl-columns" onClick={exportCsv}>
            {tx('এক্সপোর্ট')}
          </Button>
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
      <Table<Row>
        className="fl-table ml-table pl-table rt-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো পুরোনো রশিদ এন্ট্রি হয়নি') }}
      />
    </ListFrame>
  )
}
