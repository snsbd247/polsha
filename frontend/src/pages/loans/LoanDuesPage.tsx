import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Dropdown, Grid, Input, InputNumber, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, ClockCircleFilled, DownOutlined, EyeFilled, PrinterOutlined, SearchOutlined, WarningFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useLoanMeta, type LoanRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../savings/savings.css'

type DueRow = {
  id: number
  loan_no: string
  member: LoanRow['member']
  product: LoanRow['product']
  amount: string
  principal_outstanding: number
  overdue_amount: number
  penalty_due: number
  due_now: number
  days_overdue: number
  oldest_overdue: string | null
  bucket: string | null
  next_due: { date: string; amount: number } | null
  overdue_installments: number
}
type Sum = { loans: number; overdue: number; penalty: number; principal: number }
type Resp = { as_of: string; rows: DueRow[]; summary: Record<string, Sum>; total: { loans: number; overdue: number; penalty: number; due_now: number } }
type Filters = { as_of: string; bucket?: string; upcoming?: number; search?: string }

// how long overdue: the longer, the stronger the warning
const BUCKET_TONE: Record<string, string> = { '1_30': 'fl-tag-gold', '31_90': 'll-orange', '90_plus': 'fl-tag-red' }
const BUCKET_CARD: Record<string, [string, string]> = { '1_30': ['#f5a524', '#fdefd6'], '31_90': ['#f08c00', '#fde7cf'], '90_plus': ['#e5383b', '#fde4e5'] }

/** Loans with money past due on a date, aged 1–30 / 31–90 / 90+ days, with instalments coming up soon. */
export default function LoanDuesPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const wide = Grid.useBreakpoint().lg
  const meta = useLoanMeta()
  const today = dayjs().format('YYYY-MM-DD')
  const [draft, setDraft] = useState<Filters>({ as_of: today })
  const [filters, setFilters] = useState<Filters>({ as_of: today })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const { data, isFetching } = useQuery({
    queryKey: ['loan-dues', filters],
    queryFn: async () => (await api.get<Resp>('/loans/dues', { params: filters })).data,
    placeholderData: keepPreviousData,
  })
  const rows = data?.rows ?? []
  const total = rows.length
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const exportCsv = () => downloadExport('/loans/dues', { ...filters, export: 'csv' }, `loan-dues-${filters.as_of}.csv`).catch((e) => message.error(errorMessage(e)))
  const buckets = Object.entries(meta.data?.buckets ?? {})

  const cards = [
    ...buckets.map(([k, label]) => {
      const s = data?.summary[k]
      return {
        key: k,
        label: tx('মেয়াদোত্তীর্ণ {{p0}} · {{p1}}টি ঋণ', { p0: label, p1: n0(s?.loans ?? 0) }),
        value: s ? `৳ ${money(s.overdue)}` : undefined,
        icon: '',
        glyph: <WarningFilled />,
        color: BUCKET_CARD[k]?.[0] ?? '#e5383b',
        tint: BUCKET_CARD[k]?.[1] ?? '#fde4e5',
        onClick: () => show({ ...filters, bucket: k }),
      }
    }),
    {
      key: 'due',
      label: tx('মোট এখন দেয় · {{p0}}টি ঋণ', { p0: n0(data?.total.loans ?? 0) }),
      value: data ? `৳ ${money(data.total.due_now)}` : undefined,
      icon: '',
      glyph: <ClockCircleFilled />,
      color: '#1769e0',
      tint: '#e4edfd',
      onClick: () => show({ as_of: filters.as_of }),
    },
  ]

  const columns: ColumnsType<DueRow> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('ঋণ নং'), dataIndex: 'loan_no', render: (v: string, r) => <Link to={`/loans/${r.id}`} className="fl-link iv-no">{digits(v)}</Link> },
    {
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
              <span>
                {tx('সদস্য নং {{p0}}', { p0: digits(r.member?.member_no ?? '') })}
                {f.mobile && ` · ${digits(f.mobile)}`}
              </span>
            </span>
          </span>
        ) : (
          '—'
        )
      },
    },
    { title: tx('ঋণের ধরন'), render: (_, r) => nameOf(r.product) || '—' },
    { title: tx('আসল বাকি (৳)'), dataIndex: 'principal_outstanding', align: 'right', render: money },
    { title: tx('মেয়াদোত্তীর্ণ (৳)'), dataIndex: 'overdue_amount', align: 'right', render: (v: number, r) => (v ? `${money(v)} (${digits(r.overdue_installments)})` : '—') },
    { title: tx('জরিমানা (৳)'), dataIndex: 'penalty_due', align: 'right', render: (v: number) => (v ? money(v) : '—') },
    { title: tx('এখন দেয় (৳)'), dataIndex: 'due_now', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
    {
      title: tx('কত দিন'),
      dataIndex: 'days_overdue',
      render: (d: number, r) => (r.bucket ? <Tag className={`fl-tag iv-status ${BUCKET_TONE[r.bucket] ?? 'll-gray'}`}>{tx('{{p0}} দিন', { p0: digits(d) })}</Tag> : '—'),
    },
    { title: tx('পরবর্তী কিস্তি'), render: (_, r) => (r.next_due ? `${fmtDate(r.next_due.date)} — ৳${money(r.next_due.amount)}` : '—') },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/loans/${r.id}`)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('ঋণ'), to: '/loans' }}
      title={tx('ঋণের বকেয়া')}
      subtitle=""
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ঋণ নং, নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => set({ search: e.target.value || undefined })} onPressEnter={() => show(draft)} />
          </Field>
          <Field label={tx('যে তারিখে')}>
            <DatePicker format="DD-MM-YYYY" allowClear={false} value={dayjs(draft.as_of)} onChange={(d: Dayjs | null) => d && set({ as_of: d.format('YYYY-MM-DD') })} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('মেয়াদোত্তীর্ণের সময়')}>
            <Select value={draft.bucket ?? ''} options={[{ value: '', label: tx('সকল') }, ...buckets.map(([value, label]) => ({ value, label }))]} onChange={(v) => set({ bucket: v || undefined })} />
          </Field>
          <Field label={tx('আগামী কিস্তিও দেখাবে (দিন)')}>
            <InputNumber min={0} max={90} value={draft.upcoming} placeholder="0" onChange={(v) => set({ upcoming: v ?? undefined })} style={{ width: '100%' }} />
          </Field>
        </>
      }
      onSearch={() => show(draft)}
      onReset={() => show({ as_of: today })}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('বকেয়া ঋণ'), p1: n0(total) })}
      tableTools={
        <>
          <span className="sv-total">
            {tx('জরিমানা')}: <strong>৳ {money(data?.total.penalty ?? 0)}</strong>
          </span>
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
      <Table<DueRow>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={rows.slice((page - 1) * perPage, page * perPage)}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো বকেয়া নেই') }}
      />
    </ListFrame>
  )
}
