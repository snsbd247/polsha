import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, DownOutlined, EyeFilled, FileTextFilled, PlusOutlined, PrinterFilled, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import type { CombinedModule } from '../../lib/phase8'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../savings/savings.css'

type Row = {
  id: number
  payment_no: string
  date: string
  payer_name: string
  method: string
  amount: string
  status: string
  parts: { id: number; module: CombinedModule; amount: string }[]
  farmer: { id: number; farmer_code: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Resp = Paginated<Row> & {
  total_amount: number
  valid_count: number
  module_totals: Partial<Record<CombinedModule, number>>
  methods: Record<string, string>
  statuses: Record<string, string>
  modules: Record<string, string>
}
type Filters = { search?: string; status?: string; method?: string; from?: string; to?: string }

export const COMBINED_TONE: Record<string, string> = { posted: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

/** Receipts that took irrigation, loan, share and savings money in one go; the cards show how the money split (with the filters). */
export default function CombinedPaymentListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['combined-payments', params],
    queryFn: async () => (await api.get<Resp>('/combined-payments', { params })).data,
    placeholderData: keepPreviousData,
  })
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const m = data?.module_totals ?? {}
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
  const exportCsv = () => downloadExport('/combined-payments', { ...filters, export: 'csv' }, 'combined-receipts.csv').catch((e) => message.error(errorMessage(e)))
  const part = (r: Row, k: CombinedModule) => moneyOrBlank(Number(r.parts.find((p) => p.module === k)?.amount ?? 0))
  const label = (k: CombinedModule, fallback: string) => data?.modules[k] ?? fallback
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'total', label: tx('মোট আদায় · {{p0}}টি রশিদ', { p0: n0(data?.valid_count ?? 0) }), value: data ? `৳ ${money(data.total_amount)}` : undefined, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'irrigation', label: label('irrigation', tx('সেচ')), value: data ? `৳ ${money(m.irrigation ?? 0)}` : undefined, icon: 'drop', color: '#0e9f9a', tint: '#d9f4f2' },
    { key: 'loan', label: label('loan', tx('ঋণ')), value: data ? `৳ ${money(m.loan ?? 0)}` : undefined, icon: 'bank', color: '#e5383b', tint: '#fde4e5' },
    { key: 'funds', label: `${label('savings', tx('সঞ্চয়'))} + ${label('share', tx('শেয়ার'))}`, value: data ? `৳ ${money((m.savings ?? 0) + (m.share ?? 0))}` : undefined, icon: 'piggy', color: '#1f9d55', tint: '#dcf3e5' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('রশিদ নং'), dataIndex: 'payment_no', render: (v: string, r) => <Link to={`/payments/combined/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    {
      title: tx('প্রদানকারী'),
      render: (_, r) => (
        <span className="mg-who">
          <span className="ml-initials mg-initials">{initials(r.payer_name)}</span>
          {r.farmer ? (
            <span className="hs-two">
              <Link to={`/farmers/${r.farmer.id}`} className="mg-name">
                {r.payer_name}
              </Link>
              <span>{digits(r.farmer.farmer_code)}</span>
            </span>
          ) : (
            <span className="mg-name">{r.payer_name}</span>
          )}
        </span>
      ),
    },
    { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => data?.methods[v] ?? v },
    { title: `${label('irrigation', tx('সেচ'))} (৳)`, align: 'right', render: (_, r) => part(r, 'irrigation') },
    { title: `${label('loan', tx('ঋণ'))} (৳)`, align: 'right', render: (_, r) => part(r, 'loan') },
    { title: `${label('share', tx('শেয়ার'))} (৳)`, align: 'right', render: (_, r) => part(r, 'share') },
    { title: `${label('savings', tx('সঞ্চয়'))} (৳)`, align: 'right', render: (_, r) => part(r, 'savings') },
    { title: tx('মোট (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${COMBINED_TONE[v] ?? 'll-gray'}`}>{data?.statuses[v] ?? v}</Tag> },
    { title: tx('গ্রহণকারী'), render: (_, r) => nameOf(r.creator) || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/payments/combined/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<PrinterFilled />} aria-label={tx('প্রিন্ট')} onClick={() => navigate(`/payments/combined/${r.id}?print=1`)} />
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('একত্রিত পেমেন্ট')}
      subtitle=""
      actions={
        can('payment.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/combined/new')}>
            {tx('একত্রিত আদায়')}
          </Button>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('রশিদ নং, নাম বা রেফারেন্স দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('মাধ্যম')}>
            <Select value={draft.method ?? ''} options={[...all, ...Object.entries(data?.methods ?? {}).map(([value, l]) => ({ value, label: l }))]} onChange={(v) => set({ method: v || undefined })} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(data?.statuses ?? {}).map(([value, l]) => ({ value, label: l }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('একত্রিত রশিদ'), p1: n0(total) })}
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
      <Table<Row>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো রশিদ পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
