import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Spin } from 'antd'
import { FileTextOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import SubTabs, { useView } from '../../components/SubTabs'
import { api } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import StatementHeadsPage from './StatementHeadsPage'
import './receipt-payment.css'

type Row = { label: string; month: number; year: number }
type Col = { receipts: number; payments: number; opening: number; closing: number; grand: number }
type Statement = {
  fund: string
  fund_label: string
  month: string
  to: string
  fiscal_year: string
  receipts: Row[]
  payments: Row[]
  totals: { month: Col; year: Col }
  header: { name: string | null; registration_no: string | null; registration_date: string | null; address: string | null }
}

/** Whole taka with Indian grouping, blank for nothing — as the paper sheet is written. */
const taka = (v: number) => (v ? digits(Math.round(v * 100) % 100 ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('en-IN')) : '')

const FUNDS = [
  { key: 'society', label: tx('সমিতি') },
  { key: 'irrigation', label: tx('সেচ') },
  { key: 'water', label: tx('ওয়াটার সাপ্লাই') },
]

/**
 * জমা-খরচ বিবরণী of the society, irrigation and water supply funds, laid out
 * like the society's printed sheet: the heads in their order with the month
 * beside the year so far, then totals, opening cash, cash in hand and the
 * grand total, and the four signatures.
 */
export default function ReceiptPaymentPage() {
  const view = useView('society')
  const tabs = <SubTabs items={[...FUNDS, { key: 'heads', label: tx('খাত সাজান') }]} />
  if (view === 'heads') return <StatementHeadsPage tabs={tabs} />

  return <Sheet key={view} fund={FUNDS.some((f) => f.key === view) ? view : 'society'} tabs={tabs} />
}

function Sheet({ fund, tabs }: { fund: string; tabs: React.ReactNode }) {
  const [month, setMonth] = useState<Dayjs>(dayjs().subtract(dayjs().date() < 5 ? 1 : 0, 'month'))
  const [memo, setMemo] = useState('')
  const { data: s, isFetching } = useQuery({
    queryKey: ['receipt-payment', fund, month.format('YYYY-MM')],
    queryFn: async () => (await api.get<Statement>('/cashbook/receipt-payment', { params: { fund, month: month.format('YYYY-MM') } })).data,
  })

  const rows = s ? Math.max(s.receipts.length, s.payments.length) : 0
  const csv = () => {
    if (!s) return
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [[tx('ক্রমিক'), tx('জমা'), tx('মাসিক'), tx('বাৎসরিক'), tx('ক্রমিক'), tx('খরচ'), tx('মাসিক'), tx('বাৎসরিক')].map(q).join(',')]
    for (let i = 0; i < rows; i++) {
      const r = s.receipts[i]
      const p = s.payments[i]
      lines.push([r ? i + 1 : '', r?.label ?? '', r?.month || '', r?.year || '', p ? i + 1 : '', p?.label ?? '', p?.month || '', p?.year || ''].map(q).join(','))
    }
    const t = s.totals
    lines.push(['', tx('মোট'), t.month.receipts, t.year.receipts, '', tx('মোট'), t.month.payments, t.year.payments].map(q).join(','))
    lines.push(['', tx('প্রারম্ভিক মজুদ'), t.month.opening, t.year.opening, '', tx('হস্ত মজুদ'), t.month.closing, t.year.closing].map(q).join(','))
    lines.push(['', tx('সর্বমোট'), t.month.grand, t.year.grand, '', tx('সর্বমোট'), t.month.grand, t.year.grand].map(q).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `receipt-payment-${fund}-${s.month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <PageFrame className="rp-page" crumbs={[{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }, { label: tx('জমা-খরচ বিবরণী') }]} title={tx('জমা-খরচ বিবরণী')}>
      <div className="no-print">{tabs}</div>
      <div className="rp-bar no-print">
        <label>
          {tx('মাস')}
          <DatePicker picker="month" value={month} format="MMMM YYYY" allowClear={false} onChange={(d) => d && setMonth(d)} />
        </label>
        <label>
          {tx('স্মারক নং')}
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} style={{ width: 180 }} />
        </label>
        <span className="rp-spacer" />
        <Button icon={<FileTextOutlined />} onClick={csv} disabled={!s}>
          CSV
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!s}>
          {tx('প্রিন্ট / PDF')}
        </Button>
      </div>

      {!s ? (
        <Spin />
      ) : (
        <div className={`rp-sheet${isFetching ? ' rp-busy' : ''}`}>
          <header className="rp-head">
            <h2>{s.header.name}</h2>
            {(s.header.registration_no || s.header.registration_date) && (
              <p>
                {tx('রেজিঃ নং')} {digits(s.header.registration_no ?? '')}
                {s.header.registration_date && `, ${tx('তারিখ')} : ${fmtDate(s.header.registration_date)} ${tx('খ্রিষ্টাব্দ')}`}
              </p>
            )}
            {s.header.address && <p>{s.header.address}</p>}
          </header>
          <div className="rp-meta">
            <span>
              {tx('স্মারক নং')}: {memo}
            </span>
            <span>
              {tx('অর্থবছর')} : {digits(s.fiscal_year)}
            </span>
            <span>{fmtDate(s.to)}</span>
          </div>
          <table className="rp-table">
            <colgroup>
              <col className="rp-c-sl" />
              <col />
              <col className="rp-c-amt" />
              <col className="rp-c-amt" />
              <col className="rp-c-sl" />
              <col />
              <col className="rp-c-amt" />
              <col className="rp-c-amt" />
            </colgroup>
            <thead>
              <tr>
                <th colSpan={4}>{tx('জমা')}</th>
                <th colSpan={4}>{tx('খরচ')}</th>
              </tr>
              <tr>
                {[0, 1].map((k) => [
                  <th key={`sl${k}`}>{tx('ক্রমিক')}</th>,
                  <th key={`d${k}`}>{tx('বিবরণ')}</th>,
                  <th key={`m${k}`}>{tx('মাসিক')}</th>,
                  <th key={`y${k}`}>{tx('বাৎসরিক')}</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => {
                const r = s.receipts[i]
                const p = s.payments[i]
                return (
                  <tr key={i}>
                    <td className="rp-sl">{r ? digits(i + 1) : ''}</td>
                    <td>{r?.label}</td>
                    <td className="rp-amt">{r ? taka(r.month) : ''}</td>
                    <td className="rp-amt">{r ? taka(r.year) : ''}</td>
                    <td className="rp-sl">{p ? digits(i + 1) : ''}</td>
                    <td>{p?.label}</td>
                    <td className="rp-amt">{p ? taka(p.month) : ''}</td>
                    <td className="rp-amt">{p ? taka(p.year) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              {(
                [
                  [tx('মোট'), 'receipts', tx('মোট'), 'payments'],
                  [tx('প্রারম্ভিক মজুদ'), 'opening', tx('হস্ত মজুদ'), 'closing'],
                  [tx('সর্বমোট'), 'grand', tx('সর্বমোট'), 'grand'],
                ] as const
              ).map(([l, lk, r, rk]) => (
                <tr key={l + lk}>
                  <th colSpan={2}>{l}</th>
                  <td className="rp-amt">{digits(Math.round(s.totals.month[lk]).toLocaleString('en-IN'))}</td>
                  <td className="rp-amt">{digits(Math.round(s.totals.year[lk]).toLocaleString('en-IN'))}</td>
                  <th colSpan={2}>{r}</th>
                  <td className="rp-amt">{digits(Math.round(s.totals.month[rk]).toLocaleString('en-IN'))}</td>
                  <td className="rp-amt">{digits(Math.round(s.totals.year[rk]).toLocaleString('en-IN'))}</td>
                </tr>
              ))}
            </tfoot>
          </table>
          <div className="rp-signs">
            {[tx('হিসাবরক্ষক'), tx('ক্যাশিয়ার'), tx('সম্পাদক'), tx('সভাপতি')].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        </div>
      )}
    </PageFrame>
  )
}
