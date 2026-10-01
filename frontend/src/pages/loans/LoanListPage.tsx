import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, ClockCircleFilled, DownOutlined, EyeFilled, FileTextFilled, MoreOutlined, PlusOutlined, PrinterOutlined, SafetyCertificateOutlined, SearchOutlined, WarningFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useLoanMeta, useLoanProducts, type LoanRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../savings/savings.css'
import '../irrigation/rates.css'
import '../approvals/approvals.css'

type Resp = Paginated<LoanRow> & { totals: { loans: number; disbursed: number } }
type Summary = {
  total: number
  counts: Record<string, number>
  pending_amount: number
  approved_amount: number
  disbursed: number
  outstanding: number
  overdue_loans: number
  overdue_amount: number
}
type Filters = { search?: string; status?: string; product_id?: number; from?: string; to?: string }

/** Status tag tone on the approved list designs. */
export const LOAN_TONE: Record<string, string> = { pending: 'fl-tag-gold', approved: 'll-blue', active: 'fl-tag-green', closed: 'll-gray', rejected: 'fl-tag-red', cancelled: 'll-gray' }

/**
 * Every loan application and loan, with what is still owed. The menu's
 * "pending" and "approved" items open this list with the status set.
 */
export default function LoanListPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const wide = Grid.useBreakpoint().lg
  const meta = useLoanMeta()
  const products = useLoanProducts()
  const [sp] = useSearchParams()
  const preset: Filters = { status: sp.get('status') ?? undefined }
  const [draft, setDraft] = useState<Filters>(preset)
  const [filters, setFilters] = useState<Filters>(preset)
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [hidden, setHidden] = useState<string[]>([])

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['loans', params],
    queryFn: async () => (await api.get<Resp>('/loans', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['loans', 'summary'], queryFn: async () => (await api.get<Summary>('/loans/summary')).data })
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
  const exportCsv = () => downloadExport('/loans', { ...filters, export: 'csv' }, 'loans.csv').catch((e) => message.error(errorMessage(e)))
  // one list, a tab per stage of a loan's life
  const tabs = [
    { key: '', label: tx('সব ঋণ'), n: s?.total },
    { key: 'pending', label: tx('অনুমোদনের অপেক্ষায়'), n: s?.counts.pending },
    { key: 'approved', label: tx('বিতরণ বাকি'), n: s?.counts.approved },
    { key: 'active', label: tx('চলমান'), n: s?.counts.active },
    { key: 'closed', label: tx('পরিশোধিত'), n: s?.counts.closed },
  ]
  const current = tabs.find((t) => t.key === (filters.status ?? '')) ?? { label: meta.data?.statuses[filters.status ?? ''] ?? tx('ঋণের তালিকা') }

  const cards = [
    { key: 'total', label: tx('মোট ঋণ'), value: s?.total, unit: tx('টি'), icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    {
      key: 'active',
      label: tx('চলমান {{p0}}টি ঋণ — বাকি আসল', { p0: n0(s?.counts.active ?? 0) }),
      value: s ? `৳ ${money(s.outstanding)}` : undefined,
      icon: 'cash',
      color: '#1f9d55',
      tint: '#dcf3e5',
      onClick: () => show({ status: 'active' }),
    },
    {
      key: 'waiting',
      label: tx('অপেক্ষমাণ / বিতরণ বাকি'),
      value: s ? `${n0(s.counts.pending ?? 0)} / ${n0(s.counts.approved ?? 0)}` : undefined,
      icon: '',
      glyph: <ClockCircleFilled />,
      color: '#f08c00',
      tint: '#fdefd6',
      onClick: () => show({ status: 'pending' }),
    },
    {
      key: 'overdue',
      label: tx('মেয়াদোত্তীর্ণ কিস্তি · {{p0}}টি ঋণ', { p0: n0(s?.overdue_loans ?? 0) }),
      value: s ? `৳ ${money(s.overdue_amount)}` : undefined,
      icon: '',
      glyph: <WarningFilled />,
      color: '#e5383b',
      tint: '#fde4e5',
      onClick: () => navigate('/loans/dues'),
    },
  ]

  const allColumns: (ColumnsType<LoanRow>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      key: 'no',
      title: tx('ঋণ নং'),
      dataIndex: 'loan_no',
      render: (v: string, r) => (
        <Link to={`/loans/${r.id}`} className="fl-link iv-no">
          {digits(v)}
        </Link>
      ),
    },
    {
      key: 'member',
      title: tx('সদস্যের নাম'),
      render: (_, r) => {
        const f = r.member?.farmer
        return f ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>
            <span className="hs-two">
              <Link to={`/farmers/${f.id}`} className="mg-name">
                {nameOf(f)}
              </Link>
              <span>{tx('সদস্য নং {{p0}}', { p0: digits(r.member?.member_no ?? '') })}</span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { key: 'mobile', title: tx('মোবাইল'), render: (_, r) => digits(r.member?.farmer?.mobile ?? '—') },
    { key: 'product', title: tx('ঋণের ধরন'), render: (_, r) => nameOf(r.product) || '—' },
    { key: 'applied', title: tx('আবেদন'), dataIndex: 'applied_on', render: fmtDate },
    { key: 'disbursed', title: tx('বিতরণ'), dataIndex: 'disbursed_on', render: (v: string | null) => (v ? fmtDate(v) : '—') },
    { key: 'amount', title: tx('ঋণের পরিমাণ (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { key: 'owed', title: tx('আসল বাকি (৳)'), dataIndex: 'principal_outstanding', align: 'right', render: (v: number | null | undefined) => (v === null || v === undefined ? '—' : money(v)) },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${LOAN_TONE[v] ?? 'll-gray'}`}>{meta.data?.statuses[v] ?? v}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/loans/${r.id}`)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                r.status === 'active' && { key: 'pay', label: tx('কিস্তি জমা নিন'), onClick: () => navigate(`/loans/${r.id}`) },
                r.status === 'approved' && { key: 'disburse', label: tx('ঋণ বিতরণ'), onClick: () => navigate(`/loans/${r.id}`) },
                r.disbursed_on && { key: 'payments', label: tx('পরিশোধের তালিকা'), onClick: () => navigate(`/loans/payments?loan_id=${r.id}`) },
                r.member?.farmer && { key: 'farmer', label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.member!.farmer!.id}`) },
              ].filter(Boolean) as { key: string; label: string; onClick: () => void }[],
            }}
          >
            <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))
  const all = [{ value: '', label: tx('সকল') }]

  return (
    <ListFrame
      section={{ label: tx('ঋণ'), to: '/loans' }}
      title={tx('ঋণের তালিকা')}
      subtitle=""
      actions={
        <>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => navigate('/loans/audit')}>
            {tx('ঋণ অডিট')}
          </Button>
          {can('loan.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/loans/new')}>
              {tx('নতুন ঋণ')}
            </Button>
          )}
        </>
      }
      cards={cards}
      above={
        <div className="lk-tabs ap-tabs">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={(filters.status ?? '') === t.key ? 'on' : ''} onClick={() => show({ ...filters, status: t.key || undefined })}>
              {t.label}
              {!!t.n && <span className="ap-count">{digits(t.n)}</span>}
            </button>
          ))}
        </div>
      }
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ঋণ নং, নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={apply} />
          </Field>
          <Field label={tx('ঋণের ধরন')}>
            <Select value={draft.product_id ?? ''} options={[...all, ...(products.data ?? []).map((p) => ({ value: p.id, label: nameOf(p) }))]} onChange={(v) => set({ product_id: v === '' ? undefined : Number(v) })} />
          </Field>
          <Field label={tx('আবেদন (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('আবেদন (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({ status: filters.status })}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: current.label, p1: n0(total) })}
      tableTools={
        <>
          <span className="sv-total">
            {tx('বিতরণ')}: <strong>৳ {money(data?.totals.disbursed ?? 0)}</strong>
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
      <Table<LoanRow>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো ঋণ পাওয়া যায়নি') }}
      />
    </ListFrame>
  )
}
