import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, DownOutlined, EyeFilled, PercentageOutlined, PrinterFilled, PrinterOutlined, SearchOutlined, WarningFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL } from '../../lib/irrigation'
import { useLoanMeta, type LoanPayment } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../savings/savings.css'

type Totals = { amount: number; penalty: number; interest: number; principal: number }
type Resp = Paginated<LoanPayment> & { totals: Totals }
type Filters = { search?: string; status?: string; method?: string; from?: string; to?: string; loan_id?: number }

const PAYMENT_TONE: Record<string, string> = { posted: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

/** Every loan repayment receipt, split into principal, interest and penalty, over the chosen period. */
export default function LoanPaymentListPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const wide = Grid.useBreakpoint().lg
  const meta = useLoanMeta()
  const [sp] = useSearchParams()
  const preset: Filters = { loan_id: Number(sp.get('loan_id')) || undefined }
  const [draft, setDraft] = useState<Filters>(preset)
  const [filters, setFilters] = useState<Filters>(preset)
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [hidden, setHidden] = useState<string[]>([])

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['loan-payments', params],
    queryFn: async () => (await api.get<Resp>('/loans/payments', { params })).data,
    placeholderData: keepPreviousData,
  })
  const t = data?.totals
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
  const exportCsv = () => downloadExport('/loans/payments', { ...filters, export: 'csv' }, 'loan-payments.csv').catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]

  // the cards follow the filters: they total the receipts the list shows
  const cards = [
    { key: 'amount', label: tx('মোট আদায়'), value: t ? `৳ ${money(t.amount)}` : undefined, icon: 'cash', color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'principal', label: tx('আসল'), value: t ? `৳ ${money(t.principal)}` : undefined, icon: 'bank', color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'interest', label: tx('সুদ'), value: t ? `৳ ${money(t.interest)}` : undefined, icon: '', glyph: <PercentageOutlined />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'penalty', label: tx('জরিমানা'), value: t ? `৳ ${money(t.penalty)}` : undefined, icon: '', glyph: <WarningFilled />, color: '#e5383b', tint: '#fde4e5' },
  ]

  const allColumns: (ColumnsType<LoanPayment>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'no', title: tx('রশিদ নং'), dataIndex: 'payment_no', render: (v: string, r) => <Link to={`/loans/payments/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    { key: 'date', title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
    { key: 'loan', title: tx('ঋণ নং'), render: (_, r) => (r.loan ? <Link to={`/loans/${r.loan.id}`}>{digits(r.loan.loan_no)}</Link> : '—') },
    {
      key: 'member',
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.loan?.member?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <span className="mg-name">{nameOf(f)}</span>
              <span>{tx('সদস্য নং {{p0}}', { p0: digits(r.loan?.member?.member_no ?? '') })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { key: 'principal', title: tx('আসল (৳)'), dataIndex: 'principal', align: 'right', render: money },
    { key: 'interest', title: tx('সুদ (৳)'), dataIndex: 'interest', align: 'right', render: money },
    { key: 'penalty', title: tx('জরিমানা (৳)'), dataIndex: 'penalty', align: 'right', render: (v: string) => (Number(v) ? money(v) : '—') },
    { key: 'amount', title: tx('মোট (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { key: 'method', title: tx('মাধ্যম'), dataIndex: 'method', render: (m: string) => METHOD_LABEL[m] ?? m },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${PAYMENT_TONE[v] ?? 'll-gray'}`}>{meta.data?.payment_statuses[v] ?? v}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/loans/payments/${r.id}`)} />
          <Button className="fl-act pl-act" icon={<PrinterFilled />} aria-label={tx('প্রিন্ট')} onClick={() => navigate(`/loans/payments/${r.id}?print=1`)} />
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('ঋণ'), to: '/loans' }}
      title={tx('ঋণ পরিশোধ')}
      subtitle=""
      cards={cards}
      filterClass="iv-filters"
      above={
        filters.loan_id ? (
          <div className="iv-scope">
            {tx('একটি ঋণের পরিশোধ')}
            <Button size="small" type="link" onClick={() => show({})}>
              {tx('সব দেখুন')}
            </Button>
          </div>
        ) : null
      }
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('রশিদ নং, ঋণ নং, নাম বা সদস্য নং দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
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
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(meta.data?.payment_statuses ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('ঋণ পরিশোধের রশিদ'), p1: n0(total) })}
      tableTools={
        <>
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
      <Table<LoanPayment>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো পরিশোধ পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
