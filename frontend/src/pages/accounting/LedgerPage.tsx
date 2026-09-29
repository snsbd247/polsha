import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Select, Table } from 'antd'
import { DownloadOutlined, FlagFilled, LoginOutlined, LogoutOutlined, PrinterOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { VOUCHER_TYPE_LABEL, accountFilter, accountLabel, money, moneyOrBlank, useAccountOptions, type LedgerReport, type LedgerRow } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { downloadExport } from '../../lib/phase2'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../loans/loans.css'
import '../cash/cash.css'

/** Cash book for a cash/bank fund, ledger for any other account: every line in the period with its running balance. */
export default function LedgerPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const [search, setSearch] = useSearchParams()
  const { data: accounts } = useAccountOptions()

  const accountId = Number(search.get('account_id')) || undefined
  const from = search.get('from') ?? dayjs().startOf('month').format('YYYY-MM-DD')
  const to = search.get('to') ?? dayjs().format('YYYY-MM-DD')
  const [draft, setDraft] = useState<{ account?: number; from: Dayjs | null; to: Dayjs | null }>({ account: accountId, from: dayjs(from), to: dayjs(to) })
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search)
    Object.entries({ from, to, ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setSearch(next, { replace: true })
  }

  // Cashiers and bank users only see their own funds; accountants see every account.
  const options = (accounts ?? []).filter((a) => can('accounting.view') || (a.is_cash ? can('cash.view') : a.is_fund && can('bank.view')))

  const { data, isFetching } = useQuery({
    queryKey: ['ledger', accountId, from, to],
    enabled: !!accountId,
    queryFn: async () => (await api.get<LedgerReport>('/accounting/ledger', { params: { account_id: accountId, from, to } })).data,
  })

  const isCash = accounts?.find((a) => a.id === accountId)?.is_fund
  const voucherLink = (r: LedgerRow) =>
    can('accounting.view') ? (
      <Link to={`/accounting/journals/${r.journal_id}`} className="fl-link iv-no">
        {digits(r.voucher_no)}
      </Link>
    ) : (
      <span className="iv-no">{digits(r.voucher_no)}</span>
    )
  const inLabel = isCash ? tx('জমা') : tx('ডেবিট')
  const outLabel = isCash ? tx('খরচ') : tx('ক্রেডিট')
  const money0 = (v?: number) => (data ? `৳ ${money(v ?? 0)}` : undefined)

  const cards = [
    { key: 'opening', label: tx('প্রারম্ভিক জের'), value: money0(data?.opening), icon: '', glyph: <FlagFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'in', label: tx('মোট {{p0}}', { p0: inLabel }), value: money0(data?.total_debit), icon: '', glyph: <LoginOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'out', label: tx('মোট {{p0}}', { p0: outLabel }), value: money0(data?.total_credit), icon: '', glyph: <LogoutOutlined />, color: '#e5383b', tint: '#fde4e5' },
    { key: 'closing', label: tx('সমাপনী জের'), value: money0(data?.closing), icon: '', glyph: <WalletFilled />, color: '#8b3fe0', tint: '#efe4fc' },
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={isCash || !accountId ? tx('ক্যাশ বই') : tx('খতিয়ান (লেজার)')}
      subtitle=""
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('হিসাব')} grow={340}>
            <Select
              placeholder={tx('হিসাব নির্বাচন করুন')}
              value={draft.account}
              showSearch={{ filterOption: accountFilter }}
              options={options.map((a) => ({ value: a.id, label: accountLabel(a) }))}
              onChange={(v) => {
                setDraft((d) => ({ ...d, account: v }))
                set({ account_id: String(v) })
              }}
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
      onSearch={() =>
        set({
          account_id: draft.account ? String(draft.account) : undefined,
          from: (draft.from ?? dayjs().startOf('month')).format('YYYY-MM-DD'),
          to: (draft.to ?? dayjs()).format('YYYY-MM-DD'),
        })
      }
      onReset={() => {
        const f = dayjs().startOf('month')
        setDraft({ account: accountId, from: f, to: dayjs() })
        set({ from: f.format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') })
      }}
      tableTitle={data ? tx('{{p0}} · {{p1}} — {{p2}} ({{p3}})', { p0: accountLabel(data.account), p1: fmtDate(data.from), p2: fmtDate(data.to), p3: n0(data.rows.length) }) : tx('হিসাব নির্বাচন করুন')}
      tableTools={
        <>
          {can(['accounting.export', 'cash.export', 'bank.export']) && (
            <Button
              icon={<DownloadOutlined />}
              className="ml-columns pl-columns"
              disabled={!data}
              onClick={() => downloadExport('/accounting/ledger', { account_id: accountId, from, to, export: 'csv' }, `ledger-${data?.account.code}.csv`).catch((e) => message.error(errorMessage(e)))}
            >
              Excel (CSV)
            </Button>
          )}
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" disabled={!data} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
    >
      <Table<LedgerRow>
        className="fl-table ml-table pl-table iv-table"
        rowKey="line_id"
        loading={isFetching}
        dataSource={accountId ? data?.rows : []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: accountId ? tx('এই সময়ে কোনো লেনদেন নেই') : tx('হিসাব নির্বাচন করুন') }}
        columns={[
          { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
          { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
          { title: tx('ভাউচার নং'), render: (_, r) => voucherLink(r) },
          {
            title: tx('বিবরণ'),
            render: (_, r) => (
              <>
                {r.narration || VOUCHER_TYPE_LABEL[r.voucher_type]}
                {r.against.length > 0 && <span className="cs-narration">{r.against.map((a) => nameOf(a)).join(', ')}</span>}
                {r.remarks && <span className="cs-narration">{r.remarks}</span>}
              </>
            ),
          },
          { title: `${inLabel} (৳)`, dataIndex: 'debit', align: 'right', render: (v: number) => <span className="cs-in">{moneyOrBlank(v)}</span> },
          { title: `${outLabel} (৳)`, dataIndex: 'credit', align: 'right', render: (v: number) => <span className="cs-out">{moneyOrBlank(v)}</span> },
          { title: tx('জের (৳)'), dataIndex: 'balance', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
        ]}
        summary={() =>
          data ? (
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
