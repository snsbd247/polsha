import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, InputNumber, Spin } from 'antd'
import { FileTextOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import './statement.css'

type Head = { label: string; amount: number; account_ids: number[] }
type BankRow = { id: number; account_no: string; bank_name: string; opening: number; interest: number; charges: number; deposits: number; withdrawals: number; closing: number }
export type Stream = 'irrigation' | 'society'
type Statement = {
  society: string | null
  from: string
  to: string
  cash_account_id: number
  income: Head[]
  expense: Head[]
  total_income: number
  total_expense: number
  opening: number
  opening_computed: number
  closing: number
  bank_balance: number | null
  banks: BankRow[]
}

const META: Record<Stream, { title: string; subtitle: string; tag: string; api: string; csvName: string }> = {
  irrigation: { title: tx('নগদ বিবরণী (সেচ)'), subtitle: tx('অডিট রিপোর্ট — আয় ও ব্যয়ের পূর্ণ বিবরণ'), tag: tx('সেচ'), api: '/cashbook/irrigation-statement', csvName: 'irrigation' },
  society: { title: tx('নগদ বিবরণী (সমিতি)'), subtitle: tx('অডিট রিপোর্ট — সমিতির আয় ও ব্যয়ের পূর্ণ বিবরণ'), tag: tx('সমিতি'), api: '/cashbook/society-statement', csvName: 'society' },
}
const BANK_COLS = ['opening', 'interest', 'charges', 'deposits', 'withdrawals', 'closing'] as const

/** The financial year the society uses (July–June): the one today falls in. */
function fiscalYear(): [Dayjs, Dayjs] {
  const start = dayjs().month() >= 6 ? dayjs().month(6).startOf('month') : dayjs().subtract(1, 'year').month(6).startOf('month')
  return [start, start.add(1, 'year').subtract(1, 'day')]
}

const sl = (n: number) => digits(String(n).padStart(2, '0'))

/**
 * A fund's cash statement as the audit sheet is laid out: income heads beside
 * expense heads for the period, the opening fund and the fund in hand at the
 * end; signature lines below. Irrigation also shows its money in the bank;
 * the society lists every bank account's movements over the period. Prints
 * as one page.
 */
export default function FundStatementPage({ stream }: { stream: Stream }) {
  const m = META[stream]
  const [[from, to], setRange] = useState(fiscalYear)
  const [opening, setOpening] = useState<number | null>(null)
  const params = { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD'), opening: opening ?? undefined }
  const { data: s, isFetching } = useQuery({
    queryKey: ['fund-statement', stream, params],
    queryFn: async () => (await api.get<Statement>(m.api, { params })).data,
    placeholderData: (prev) => prev,
  })

  const rows = s ? Array.from({ length: Math.max(s.income.length, s.expense.length, 1) }, (_, i) => [s.income[i], s.expense[i]] as const) : []
  const ledger = s ? `/accounting/ledger?account_id=${s.cash_account_id}&from=${s.from}&to=${s.to}` : '#'
  const period = s ? tx('{{p0}} থেকে {{p1}} পর্যন্ত নগদ বিবরণী', { p0: fmtDate(s.from), p1: fmtDate(s.to) }) : ''

  const csv = () => {
    if (!s) return
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [
      [`${s.society ?? ''} — ${period} (${m.tag})`],
      [tx('আয়'), '', '', tx('ব্যয়'), '', ''],
      [tx('ক্রমিক'), tx('বিবরণ'), tx('টাকা'), tx('ক্রমিক'), tx('বিবরণ'), tx('টাকা')],
      ...rows.map(([i, e], k) => [i ? k + 1 : '', i?.label ?? '', i?.amount ?? '', e ? k + 1 : '', e?.label ?? '', e?.amount ?? '']),
      ['', tx('মোট আয়'), s.total_income, '', tx('মোট ব্যয়'), s.total_expense],
      ['', tx('প্রারম্ভিক তহবিল'), s.opening, '', tx('হাতে নগদ তহবিল'), s.closing],
      ['', tx('সর্বমোট'), s.opening + s.total_income, '', tx('সর্বমোট'), s.total_expense + s.closing],
      ...(s.bank_balance !== null ? [['', '', '', '', tx('ব্যাংক জমা (শেষ তারিখে)'), s.bank_balance]] : []),
      ...(s.banks.length
        ? [
            [],
            [tx('ব্যাংক হিসাব')],
            [tx('ক্রমিক'), tx('হিসাব নং'), fmtDate(s.from), tx('প্রাপ্ত সুদ'), tx('কর্তনকৃত ব্যাংক চার্জ'), tx('ব্যাংকে জমা'), tx('ব্যাংক থেকে উত্তোলন'), fmtDate(s.to)],
            ...s.banks.map((b, k) => [k + 1, `${b.account_no} (${b.bank_name})`, ...BANK_COLS.map((f) => b[f])]),
          ]
        : []),
    ]
    const blob = new Blob(['﻿' + lines.map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${m.csvName}-cash-statement-${s.from}-${s.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <PageFrame className="cst-page" crumbs={[{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }, { label: m.title }]} title={m.title} subtitle={m.subtitle}>
      <div className="cst-bar no-print">
        <label>
          {tx('শুরুর তারিখ')}
          <DatePicker value={from} format="DD-MM-YYYY" allowClear={false} onChange={(d) => d && setRange([d, d.isAfter(to) ? d : to])} />
        </label>
        <label>
          {tx('যে তারিখ পর্যন্ত')}
          <DatePicker value={to} format="DD-MM-YYYY" allowClear={false} disabledDate={(d) => d.isBefore(from, 'day')} onChange={(d) => d && setRange([from, d])} />
        </label>
        <label>
          {tx('প্রারম্ভিক তহবিল (টাকা)')}
          <InputNumber value={opening} precision={2} placeholder={s ? money(s.opening_computed) : ''} onChange={(v) => setOpening(v === null ? null : Number(v))} style={{ width: 170 }} title={tx('খালি রাখলে হিসাব থেকে নিজে বসবে')} />
        </label>
        <span className="cst-spacer" />
        <Button icon={<FileTextOutlined />} onClick={csv} disabled={!s}>
          {stream === 'society' ? 'Excel' : 'CSV'}
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!s}>
          {stream === 'society' ? tx('প্রিন্ট') : tx('প্রিন্ট / PDF')}
        </Button>
      </div>

      {!s ? (
        <Spin />
      ) : (
        <div className={`cst-sheet${isFetching ? ' cst-busy' : ''}`}>
          <h2>{tx('{{p0}} - এর', { p0: s.society ?? '' })}</h2>
          <p className="cst-sub">
            {period} <b>({m.tag})</b>
          </p>
          <table className="cst-table">
            <thead>
              <tr>
                <th colSpan={3}>{tx('আয়')}</th>
                <th colSpan={3}>{tx('ব্যয়')}</th>
              </tr>
              <tr>
                <th className="cst-sl">{tx('ক্রমিক')}</th>
                <th>{tx('বিবরণ')}</th>
                <th className="cst-amt">{tx('টাকা')}</th>
                <th className="cst-sl">{tx('ক্রমিক')}</th>
                <th>{tx('বিবরণ')}</th>
                <th className="cst-amt">{tx('টাকা')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([i, e], k) => (
                <tr key={k}>
                  <td className="cst-sl">{i ? sl(k + 1) : ''}</td>
                  <td>{i?.label ?? ''}</td>
                  <td className="cst-amt">{i ? money(i.amount) : ''}</td>
                  <td className="cst-sl">{e ? sl(k + 1) : ''}</td>
                  <td>{e?.label ?? ''}</td>
                  <td className="cst-amt">{e ? money(e.amount) : ''}</td>
                </tr>
              ))}
              <tr className="cst-total">
                <td colSpan={2}>{tx('মোট আয়')} =</td>
                <td className="cst-amt">
                  <Link to={ledger}>{money(s.total_income)}</Link>
                </td>
                <td colSpan={2}>{tx('মোট ব্যয়')} =</td>
                <td className="cst-amt">
                  <Link to={ledger}>{money(s.total_expense)}</Link>
                </td>
              </tr>
              <tr className="cst-total">
                <td colSpan={2}>{tx('প্রারম্ভিক তহবিল')} =</td>
                <td className="cst-amt">{money(s.opening)}</td>
                <td colSpan={2}>{tx('হাতে নগদ তহবিল')} =</td>
                <td className="cst-amt">{money(s.closing)}</td>
              </tr>
              <tr className="cst-total">
                <td colSpan={2}>{tx('সর্বমোট')} =</td>
                <td className="cst-amt">{money(s.opening + s.total_income)}</td>
                <td colSpan={2}>{tx('সর্বমোট')} =</td>
                <td className="cst-amt">{money(s.total_expense + s.closing)}</td>
              </tr>
              {s.bank_balance !== null && (
                <tr className="cst-total">
                  <td colSpan={5}>{tx('ব্যাংক জমা (শেষ তারিখে)')} =</td>
                  <td className="cst-amt">{money(s.bank_balance)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="cst-signs">
            {[tx('নিরীক্ষা কর্মকর্তা'), tx('সভাপতি'), tx('সাধারণ সম্পাদক'), tx('কোষাধ্যক্ষ')].map((role) => (
              <div key={role}>
                <b>{role}</b>
                <small>{s.society}</small>
              </div>
            ))}
          </div>
          <p className="cst-committee">{tx('ব্যবস্থাপনা কমিটির সদস্যদের স্বাক্ষর:')}</p>
          <div className="cst-committee-lines">
            <span>{digits(1)}.</span>
            <span>{digits(2)}.</span>
            <span>{digits(3)}.</span>
          </div>
          {s.banks.length > 0 && (
            <>
              <p className="cst-committee">{tx('পর্যবেক্ষণ (ব্যাংক হিসাব): নিরীক্ষাকালে সমিতির নিচের ব্যাংক হিসাবগুলো দেখা হয়েছে।')}</p>
              <table className="cst-table cst-banks">
                <thead>
                  <tr>
                    <th className="cst-sl">{tx('ক্রমিক')}</th>
                    <th>{tx('হিসাব নং')}</th>
                    <th>{fmtDate(s.from)}</th>
                    <th>{tx('প্রাপ্ত সুদ')}</th>
                    <th>{tx('কর্তনকৃত ব্যাংক চার্জ')}</th>
                    <th>{tx('ব্যাংকে জমা')}</th>
                    <th>{tx('ব্যাংক থেকে উত্তোলন')}</th>
                    <th>{fmtDate(s.to)}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.banks.map((b, k) => (
                    <tr key={b.id}>
                      <td className="cst-sl">{sl(k + 1)}</td>
                      <td>
                        {digits(b.account_no)} ({b.bank_name})
                      </td>
                      {BANK_COLS.map((f) => (
                        <td key={f} className="cst-amt">
                          {money(b[f])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="cst-total">
                    <td colSpan={2}>{tx('মোট')} =</td>
                    {BANK_COLS.map((f) => (
                      <td key={f} className="cst-amt">
                        {money(s.banks.reduce((n, b) => n + b[f], 0))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </PageFrame>
  )
}
