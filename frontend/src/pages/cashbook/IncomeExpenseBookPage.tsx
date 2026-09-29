import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, DatePicker, Input, Select, Table, Tag } from 'antd'
import { FallOutlined, FileTextFilled, RiseOutlined, SearchOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import type { ReportResult } from '../../lib/reports'
import { t as tx } from '../../lib/i18n'
import ListFrame, { ExportMenu, Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../loans/loans.css'
import '../cash/cash.css'

type Row = { journal_id: number; account_id: number; type: 'income' | 'expense'; date: string; voucher_no: string; account: string; narration: string | null; income: number; expense: number }
type Filters = { from: string; to: string; search?: string; type?: string; account_id?: number }

const KEY = 'income_expense_cashbook'
const month = (): Filters => ({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') })

/** Every income and expense line of the period, with the net surplus (or deficit). */
export default function IncomeExpenseBookPage() {
  const { can } = useAuth()
  const [filters, setFilters] = useState<Filters>(month)
  const [draft, setDraft] = useState<{ from: Dayjs | null; to: Dayjs | null; search?: string; type?: string; account_id?: number }>({ from: dayjs(filters.from), to: dayjs(filters.to) })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  const { data, isFetching } = useQuery({
    queryKey: ['report', KEY, filters.from, filters.to],
    queryFn: async () => (await api.get<ReportResult>(`/reports/${KEY}`, { params: { from: filters.from, to: filters.to } })).data,
  })
  const all = (data?.rows ?? []) as unknown as Row[]
  const term = toEnDigits(filters.search ?? '').toLowerCase()
  const rows = all.filter(
    (r) =>
      (!filters.type || r.type === filters.type) &&
      (!filters.account_id || r.account_id === filters.account_id) &&
      (!term ||
        toEnDigits(`${r.voucher_no} ${r.account} ${r.narration ?? ''}`)
          .toLowerCase()
          .includes(term)),
  )
  const income = rows.reduce((s, r) => s + Number(r.income), 0)
  const expense = rows.reduce((s, r) => s + Number(r.expense), 0)
  const net = income - expense
  const heads = [...new Map(all.map((r) => [r.account_id, r])).values()].sort((a, b) => a.account.localeCompare(b.account))
  const total = rows.length
  const from = total ? (page - 1) * perPage + 1 : 0

  // the cards narrow by type within the same period
  const show = (patch: { type?: string }) => {
    setFilters((f) => ({ ...f, type: undefined, account_id: undefined, search: undefined, ...patch }))
    setDraft((d) => ({ ...d, type: undefined, account_id: undefined, search: undefined, ...patch }))
    setPage(1)
  }
  const apply = () => {
    setFilters({ from: (draft.from ?? dayjs().startOf('month')).format('YYYY-MM-DD'), to: (draft.to ?? dayjs()).format('YYYY-MM-DD'), search: draft.search, type: draft.type, account_id: draft.account_id })
    setPage(1)
  }
  const reset = () => {
    const f = month()
    setFilters(f)
    setDraft({ from: dayjs(f.from), to: dayjs(f.to) })
    setPage(1)
  }
  const amt = (v: number) => (data ? `৳ ${money(v)}` : undefined)

  const cards = [
    { key: 'income', label: tx('মোট আয়'), value: amt(income), icon: '', glyph: <RiseOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ type: 'income' }) },
    { key: 'expense', label: tx('মোট ব্যয়'), value: amt(expense), icon: '', glyph: <FallOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ type: 'expense' }) },
    { key: 'net', label: net < 0 ? tx('নিট ঘাটতি') : tx('নিট উদ্বৃত্ত'), value: amt(Math.abs(net)), icon: '', glyph: <WalletFilled />, color: net < 0 ? '#f08c00' : '#8b3fe0', tint: net < 0 ? '#fdefd6' : '#efe4fc' },
    {
      key: 'count',
      label: tx('এন্ট্রি · {{p0}}টি খাত', { p0: n0(new Set(rows.map((r) => r.account_id)).size) }),
      value: data ? total : undefined,
      icon: '',
      glyph: <FileTextFilled />,
      color: '#1769e0',
      tint: '#e4edfd',
      onClick: () => show({}),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }}
      title={tx('আয়-ব্যয় নগদ বই')}
      subtitle=""
      cards={cards}
      above={data?.truncated ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={data.notice ?? tx('অনেক বেশি এন্ট্রি — তারিখের সীমা ছোট করুন।')} /> : undefined}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={260}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ভাউচার নং, খাত বা বিবরণ...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={apply} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={draft.from} onChange={(d) => setDraft((x) => ({ ...x, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={draft.to} onChange={(d) => setDraft((x) => ({ ...x, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('ধরন')}>
            <Select
              value={draft.type ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'income', label: tx('আয়') },
                { value: 'expense', label: tx('ব্যয়') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))}
            />
          </Field>
          <Field label={tx('খাত')} grow={200}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.account_id ?? 0}
              options={[{ value: 0, label: tx('সকল') }, ...heads.map((h) => ({ value: h.account_id, label: digits(h.account) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, account_id: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={reset}
      tableTitle={tx('{{p0}} — {{p1}} ({{p2}})', { p0: fmtDate(filters.from), p1: fmtDate(filters.to), p2: n0(total) })}
      tableTools={<ExportMenu reports={[{ key: KEY, label: tx('আয়-ব্যয় নগদ বই') }]} filters={{ from: filters.from, to: filters.to }} />}
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
        rowKey={(r, i) => `${r.journal_id}-${r.account_id}-${i}`}
        loading={isFetching}
        dataSource={rows.slice((page - 1) * perPage, page * perPage)}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: tx('এই সময়ে কোনো আয় বা ব্যয় নেই') }}
        columns={[
          { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
          { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
          {
            title: tx('ভাউচার নং'),
            render: (_, r) =>
              can('accounting.view') ? (
                <Link to={`/accounting/journals/${r.journal_id}`} className="fl-link iv-no">
                  {digits(r.voucher_no)}
                </Link>
              ) : (
                <span className="iv-no">{digits(r.voucher_no)}</span>
              ),
          },
          { title: tx('খাত'), render: (_, r) => <Tag className={`fl-tag ${r.type === 'income' ? 'fl-tag-green' : 'fl-tag-red'}`}>{digits(r.account)}</Tag> },
          { title: tx('বিবরণ'), dataIndex: 'narration', render: (v: string | null) => v || '—' },
          { title: tx('আয় (৳)'), dataIndex: 'income', align: 'right', render: (v: number) => <span className="cs-in">{moneyOrBlank(v)}</span> },
          { title: tx('ব্যয় (৳)'), dataIndex: 'expense', align: 'right', render: (v: number) => <span className="cs-out">{moneyOrBlank(v)}</span> },
        ]}
        summary={() =>
          rows.length ? (
            <Table.Summary.Row className="ln-sum-row">
              <Table.Summary.Cell index={0} colSpan={5}>
                {tx('মোট')} — {net < 0 ? tx('নিট ঘাটতি') : tx('নিট উদ্বৃত্ত')}: ৳ {money(Math.abs(net))}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                {money(income)}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                {money(expense)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }
      />
    </ListFrame>
  )
}
