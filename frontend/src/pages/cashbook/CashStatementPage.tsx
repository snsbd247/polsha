import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Table } from 'antd'
import { BookOutlined, FlagFilled, LoginOutlined, LogoutOutlined, SearchOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { VOUCHER_TYPE_LABEL, money, moneyOrBlank, useAccountOptions, type LedgerReport, type LedgerRow } from '../../lib/accounting'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { ExportMenu, Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../loans/loans.css'
import '../cash/cash.css'

type Stream = 'cash_irrigation' | 'cash_society'
const TITLE: Record<Stream, string> = { cash_irrigation: tx('সেচ নগদ বিবরণী'), cash_society: tx('সমিতির নগদ বিবরণী') }
type Filters = { from: string; to: string; search?: string }

const month = (): Filters => ({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') })

/** The irrigation cash (or the society's cash) statement: every cash line of the period with its running balance. */
export default function CashStatementPage({ stream }: { stream: Stream }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: accounts } = useAccountOptions()
  const account = accounts?.find((a) => a.key === stream)
  const [filters, setFilters] = useState<Filters>(month)
  const [draft, setDraft] = useState<{ from: Dayjs | null; to: Dayjs | null; search?: string }>({ from: dayjs(filters.from), to: dayjs(filters.to) })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  const { data, isFetching } = useQuery({
    queryKey: ['ledger', account?.id, filters.from, filters.to],
    enabled: !!account,
    queryFn: async () => (await api.get<LedgerReport>('/accounting/ledger', { params: { account_id: account!.id, from: filters.from, to: filters.to } })).data,
  })

  const term = toEnDigits(filters.search ?? '').toLowerCase()
  const rows = (data?.rows ?? []).filter(
    (r) =>
      !term ||
      toEnDigits(`${r.voucher_no} ${r.narration ?? ''} ${r.against.map((a) => nameOf(a)).join(' ')}`)
        .toLowerCase()
        .includes(term),
  )
  const total = rows.length
  const from = total ? (page - 1) * perPage + 1 : 0
  const shown = rows.slice((page - 1) * perPage, page * perPage)
  const money0 = (v?: number) => (data ? `৳ ${money(v ?? 0)}` : undefined)
  const days = data ? new Set(data.rows.map((r) => r.date)).size : 0

  const apply = () => {
    setFilters({ from: (draft.from ?? dayjs().startOf('month')).format('YYYY-MM-DD'), to: (draft.to ?? dayjs()).format('YYYY-MM-DD'), search: draft.search })
    setPage(1)
  }
  const reset = () => {
    const f = month()
    setFilters(f)
    setDraft({ from: dayjs(f.from), to: dayjs(f.to) })
    setPage(1)
  }

  const cards = [
    { key: 'opening', label: tx('প্রারম্ভিক জের'), value: money0(data?.opening), icon: '', glyph: <FlagFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'in', label: tx('মোট জমা'), value: money0(data?.total_debit), icon: '', glyph: <LoginOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'out', label: tx('মোট খরচ'), value: money0(data?.total_credit), icon: '', glyph: <LogoutOutlined />, color: '#e5383b', tint: '#fde4e5' },
    { key: 'closing', label: tx('সমাপনী জের · {{p0}} দিনের লেনদেন', { p0: n0(days) }), value: money0(data?.closing), icon: '', glyph: <WalletFilled />, color: '#8b3fe0', tint: '#efe4fc' },
  ]

  return (
    <ListFrame
      section={{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }}
      title={TITLE[stream]}
      subtitle=""
      actions={
        account && (
          <Button icon={<BookOutlined />} onClick={() => navigate(`/accounting/ledger?account_id=${account.id}&from=${filters.from}&to=${filters.to}`)}>
            {tx('ক্যাশ বই (খতিয়ান)')}
          </Button>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('ভাউচার নং, বিবরণ বা বিপরীত হিসাব...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={draft.from} onChange={(d) => setDraft((x) => ({ ...x, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={draft.to} onChange={(d) => setDraft((x) => ({ ...x, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={reset}
      tableTitle={tx('{{p0}} — {{p1}} ({{p2}})', { p0: fmtDate(filters.from), p1: fmtDate(filters.to), p2: n0(total) })}
      tableTools={<ExportMenu reports={[{ key: stream, label: TITLE[stream] }]} filters={{ from: filters.from, to: filters.to }} />}
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
      <Table<LedgerRow>
        className="fl-table ml-table pl-table iv-table"
        rowKey="line_id"
        loading={isFetching || !accounts}
        dataSource={shown}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: tx('এই সময়ে কোনো লেনদেন নেই') }}
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
          {
            title: tx('বিবরণ'),
            render: (_, r) => (
              <>
                {r.narration || VOUCHER_TYPE_LABEL[r.voucher_type]}
                {r.against.length > 0 && <span className="cs-narration">{r.against.map((a) => nameOf(a)).join(', ')}</span>}
              </>
            ),
          },
          { title: tx('জমা (৳)'), dataIndex: 'debit', align: 'right', render: (v: number) => <span className="cs-in">{moneyOrBlank(v)}</span> },
          { title: tx('খরচ (৳)'), dataIndex: 'credit', align: 'right', render: (v: number) => <span className="cs-out">{moneyOrBlank(v)}</span> },
          { title: tx('জের (৳)'), dataIndex: 'balance', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
        ]}
        summary={() =>
          data && !term ? (
            <Table.Summary.Row className="ln-sum-row">
              <Table.Summary.Cell index={0} colSpan={4}>
                {tx('মোট')} ({tx('প্রারম্ভিক জের')}: ৳ {money(data.opening)})
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                {money(data.total_debit)}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                {money(data.total_credit)}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                {money(data.closing)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }
      />
    </ListFrame>
  )
}
