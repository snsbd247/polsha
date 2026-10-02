import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CalendarFilled, CloseOutlined, DownOutlined, EyeFilled, FileTextFilled, PlusOutlined, PrinterFilled, PrinterOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
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
  receipt_no: string
  date: string
  payer_name: string
  method: string
  reference: string | null
  is_legacy: boolean
  legacy_no: string | null
  amount: string
  status: string
  farmer: { id: number; farmer_code: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
}
type Summary = { count: number; amount: number; today_count: number; today_amount: number; month_amount: number; cancelled: number; cancel_pending: number }
type Filters = { search?: string; status?: string; method?: string; is_legacy?: string; from?: string; to?: string }

export const RECEIPT_TONE: Record<string, string> = { active: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

/** Every money receipt (irrigation collections and old hand-written ones), with cards, filters and exports. */
export default function ReceiptListPage({ tabs }: { tabs?: ReactNode }) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [hidden, setHidden] = useState<string[]>([])

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['receipts', params],
    queryFn: async () => (await api.get<Paginated<Row> & { total_amount: number }>('/receipts', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['receipts', 'summary'], queryFn: async () => (await api.get<Summary>('/receipts/summary')).data })
  const s = summary.data
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
  const exportCsv = () => downloadExport('/receipts', { ...filters, export: 'csv' }, 'receipts.csv').catch((e) => message.error(errorMessage(e)))
  const today = dayjs().format('YYYY-MM-DD')
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'count', label: tx('মোট রশিদ'), value: s?.count, unit: tx('টি'), icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'amount', label: tx('মোট আদায়'), value: s ? `৳ ${money(s.amount)}` : undefined, icon: 'cash', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'active' }) },
    {
      key: 'today',
      label: tx('আজকের আদায় · {{p0}}টি', { p0: n0(s?.today_count ?? 0) }),
      value: s ? `৳ ${money(s.today_amount)}` : undefined,
      icon: '',
      glyph: <CalendarFilled />,
      color: '#f08c00',
      tint: '#fdefd6',
      onClick: () => show({ from: today, to: today }),
    },
    {
      key: 'cancelled',
      label: tx('বাতিল / বাতিলের অপেক্ষায়'),
      value: s ? `${n0(s.cancelled)} / ${n0(s.cancel_pending)}` : undefined,
      icon: '',
      solid: <CloseOutlined />,
      color: '#e5383b',
      tint: '#fde4e5',
      onClick: () => show({ status: 'cancelled' }),
    },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      key: 'no',
      title: tx('রশিদ নং'),
      dataIndex: 'receipt_no',
      render: (v: string, r) => (
        <Link to={`/payments/receipts/${r.id}`} className="fl-link iv-no">
          {digits(v)}
        </Link>
      ),
    },
    { key: 'legacy', title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', render: (v: string | null) => (v ? digits(v) : '—') },
    { key: 'date', title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    {
      key: 'payer',
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
    { key: 'method', title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => METHOD_LABEL[v] ?? v },
    { key: 'ref', title: tx('রেফারেন্স'), dataIndex: 'reference', render: (v: string | null) => (v ? digits(v) : '—') },
    { key: 'amount', title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    {
      key: 'status',
      title: tx('অবস্থা'),
      dataIndex: 'status',
      render: (v: string, r) => (
        <span className="hs-two">
          <Tag className={`fl-tag iv-status ${RECEIPT_TONE[v] ?? 'll-gray'}`}>{RECEIPT_STATUS_LABEL[v] ?? v}</Tag>
          {r.is_legacy && <span>{tx('পুরনো রশিদ')}</span>}
        </span>
      ),
    },
    { key: 'by', title: tx('গ্রহণকারী'), render: (_, r) => nameOf(r.creator) || '—' },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/payments/receipts/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<PrinterFilled />} aria-label={tx('প্রিন্ট')} onClick={() => navigate(`/payments/receipts/${r.id}?print=1`)} />
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('রশিদ')}
      subtitle=""
      above={tabs}
      actions={
        can('payment.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/payments/collect')}>
            {tx('টাকা আদায়')}
          </Button>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={300}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('রশিদ নং, নাম বা রেফারেন্স দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('মাধ্যম')}>
            <Select value={draft.method ?? ''} options={[...all, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ method: v || undefined })} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(RECEIPT_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
          <Field label={tx('রশিদের ধরন')}>
            <Select value={draft.is_legacy ?? ''} options={[...all, { value: '0', label: tx('সফটওয়্যারের রশিদ') }, { value: '1', label: tx('পুরনো (হাতে লেখা) রশিদ') }]} onChange={(v) => set({ is_legacy: v || undefined })} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('টাকার রশিদ'), p1: n0(total) })}
      tableTools={
        <>
          <span className="sv-total">
            {tx('মোট (বাতিল ছাড়া)')}: <strong>৳ {money(data?.total_amount ?? 0)}</strong>
          </span>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'csv', label: 'Excel (CSV)', onClick: exportCsv },
                {
                  key: 'cols',
                  label: tx('কলাম'),
                  children: hideable.map((c) => ({
                    key: `col-${c.key}`,
                    label: (
                      <Checkbox checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                        {c.title as string}
                      </Checkbox>
                    ),
                  })),
                },
              ],
            }}
          >
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
