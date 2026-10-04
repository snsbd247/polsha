import { useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Modal, Pagination, Select, Spin } from 'antd'
import { FileExcelOutlined, FileTextOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import './statement.css'
import './cashbook-sheet.css'

type Column = { key: string; label: string }
type Row = { id: number; date: string; ref: string; party: string | null; voucher_no: string; cells: Record<string, number>; total: number }
type Side = { columns: Column[]; rows: Row[]; total: number }
type Book = {
  from: string
  to: string
  society: { name: string | null; address: string | null; mobile: string | null; email: string | null }
  income: Side
  expense: Side
  opening: number
  closing: number
}
export type BookStream = 'society' | 'irrigation' | 'water'
type Which = 'both' | 'income' | 'expense'

const PER_PAGE = 25
const TITLE: Record<BookStream, string> = { society: tx('আয়-ব্যয় নগদ বই (সমিতি)'), irrigation: tx('সেচের আয়-ব্যয় নগদ বই'), water: tx('পানির আয়-ব্যয় নগদ বই') }
const amt = (v: number | undefined) => (v ? money(v) : '')

/**
 * The fund's income-expense cash book as the society keeps it on paper: the
 * society's name and address beside the book's title, then income and
 * expense side by side — every cash voucher on its own line, its money spread
 * over head columns, the day's total on the day's first line — and below,
 * the totals with the cash brought forward and the cash in hand. A column
 * total opens the vouchers behind it. Prints every line.
 */
export default function CashBookSheetPage({ stream, tabs }: { stream: BookStream; tabs?: ReactNode }) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs()])
  const [which, setWhich] = useState<Which>('both')
  const [printing, setPrinting] = useState(false)
  const params = { stream, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') }
  const { data: b, isFetching } = useQuery({
    queryKey: ['income-expense-book', params],
    queryFn: async () => (await api.get<Book>('/cashbook/income-expense-book', { params })).data,
    placeholderData: (prev) => prev,
  })

  // every line goes on paper, not only the page on screen
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const title = TITLE[stream]
  const period = b ? tx('{{p0}} থেকে {{p1}}', { p0: fmtDate(b.from), p1: fmtDate(b.to) }) : ''
  const sides = (['income', 'expense'] as const).filter((s) => which === 'both' || which === s)

  const table = (side: 'income' | 'expense') => {
    if (!b) return []
    const d = b[side]
    const head = [tx('তারিখ'), side === 'income' ? tx('রশিদ নং') : tx('ভাউচার নং'), side === 'income' ? tx('কার কাছ থেকে') : tx('ব্যয়ের খাত / কাকে'), ...d.columns.map((c) => c.label), tx('মোট'), tx('দিনের মোট')]
    const dayTotal = dayTotals(d.rows)
    const body = d.rows.map((r, i) => [fmtDate(r.date), r.ref, r.party ?? '', ...d.columns.map((c) => r.cells[c.key] ?? ''), r.total, i === 0 || d.rows[i - 1].date !== r.date ? dayTotal[r.date] : ''])
    const sums = d.columns.map((c) => colSum(d.rows, c.key))
    const foot =
      side === 'income'
        ? [
            [tx('মোট আয়') + ' =', '', '', ...sums, d.total, ''],
            [tx('পূর্ববর্তী জের') + ' =', '', '', ...d.columns.map(() => ''), b.opening, ''],
            [tx('সর্বমোট আয়') + ' =', '', '', ...d.columns.map(() => ''), b.opening + d.total, ''],
          ]
        : [
            [tx('মোট ব্যয়') + ' =', '', '', ...sums, d.total, ''],
            [tx('হাতে নগদ জের') + ' =', '', '', ...d.columns.map(() => ''), b.closing, ''],
            [tx('সর্বমোট ব্যয়') + ' =', '', '', ...d.columns.map(() => ''), d.total + b.closing, ''],
          ]
    return [[side === 'income' ? tx('আয়') : tx('ব্যয়')], head, ...body, ...foot]
  }
  const fileName = (ext: string) => `${stream}-income-expense-cashbook-${params.from}-${params.to}.${ext}`
  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const top = () => (b ? [[b.society.name ?? ''], [`${title} — ${period}`]] : [])
  const csv = () => {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [...top(), ...sides.flatMap((s) => [[], ...table(s)])]
    save(new Blob(['﻿' + lines.map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), fileName('csv'))
  }
  // an HTML table that Excel opens as a sheet, Bangla intact
  const excel = () => {
    const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const lines = [...top(), ...sides.flatMap((s) => [[], ...table(s)])]
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1">${lines.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></body></html>`
    save(new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' }), fileName('xls'))
  }

  return (
    <PageFrame className="cbs-page" crumbs={[{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }, { label: title }]} title={tx('আয়-ব্যয় নগদ বই')}>
      {tabs && <div className="no-print">{tabs}</div>}
      <div className="cst-bar cbs-bar no-print">
        <label>
          {tx('শুরুর তারিখ')}
          <DatePicker value={range[0]} format="DD-MM-YYYY" allowClear={false} onChange={(d) => d && setRange([d, d.isAfter(range[1]) ? d : range[1]])} />
        </label>
        <label>
          {tx('যে তারিখ পর্যন্ত')}
          <DatePicker value={range[1]} format="DD-MM-YYYY" allowClear={false} disabledDate={(d) => d.isBefore(range[0], 'day')} onChange={(d) => d && setRange([range[0], d])} />
        </label>
        <label>
          {tx('রিপোর্টের ধরন')}
          <Select<Which>
            value={which}
            onChange={setWhich}
            style={{ width: 150 }}
            options={[
              { value: 'both', label: tx('আয় ও ব্যয়') },
              { value: 'income', label: tx('শুধু আয়') },
              { value: 'expense', label: tx('শুধু ব্যয়') },
            ]}
          />
        </label>
        <span className="cst-spacer" />
        <Button icon={<FileExcelOutlined />} onClick={excel} disabled={!b}>
          Excel
        </Button>
        <Button icon={<FileTextOutlined />} onClick={csv} disabled={!b}>
          CSV
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!b}>
          {tx('প্রিন্ট')}
        </Button>
      </div>
      <p className="cbs-tip no-print">{tx('যেকোনো কলামের মোটে ক্লিক করলে তার পেছনের লেনদেনগুলো দেখা যাবে।')}</p>

      {!b ? (
        <Spin />
      ) : (
        <div className={`cbs-sheet${isFetching ? ' cst-busy' : ''}`}>
          <header className="cbs-head">
            <div>
              <h2>{b.society.name}</h2>
              {b.society.address && <p className="cbs-addr">{b.society.address}</p>}
              {b.society.mobile && (
                <p>
                  {tx('মোবাইল')}: {digits(b.society.mobile)}
                </p>
              )}
              {b.society.email && (
                <p>
                  {tx('ইমেইল')}: {b.society.email}
                </p>
              )}
            </div>
            <div className="cbs-title">
              <h2>{title}</h2>
              <p>{period}</p>
              <p>
                <b>{which === 'both' ? tx('আয় ও ব্যয়') : which === 'income' ? tx('আয়') : tx('ব্যয়')}</b>
              </p>
            </div>
          </header>
          <div className={`cbs-sides${sides.length === 2 ? ' cbs-two' : ''}`}>
            {sides.map((s) => (
              <BookSide key={`${s}-${params.from}-${params.to}`} side={s} data={b[s]} opening={b.opening} closing={b.closing} printing={printing} />
            ))}
          </div>
        </div>
      )}
    </PageFrame>
  )
}

const colSum = (rows: Row[], key: string) => Math.round(rows.reduce((n, r) => n + (r.cells[key] ?? 0), 0) * 100) / 100
const dayTotals = (rows: Row[]) => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.date]: Math.round(((m[r.date] ?? 0) + r.total) * 100) / 100 }), {})

/** One side of the book: its lines a page at a time, then the totals. */
function BookSide({ side, data, opening, closing, printing }: { side: 'income' | 'expense'; data: Side; opening: number; closing: number; printing: boolean }) {
  const { can } = useAuth()
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Column | null>(null)
  const income = side === 'income'
  const pages = Math.max(1, Math.ceil(data.rows.length / PER_PAGE))
  const shown = printing ? data.rows : data.rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const dayTotal = dayTotals(data.rows)
  const cols = data.columns.length
  // the date and the day's total span all of that day's lines on this page
  const span = (i: number) => {
    if (i > 0 && shown[i - 1].date === shown[i].date) return 0
    let n = 1
    while (i + n < shown.length && shown[i + n].date === shown[i].date) n++
    return n
  }
  const ref = (r: Row) =>
    can('accounting.view') ? (
      <Link to={`/accounting/journals/${r.id}`} title={r.voucher_no}>
        {digits(r.ref)}
      </Link>
    ) : (
      digits(r.ref)
    )
  const totalCell = (c: Column) => {
    const v = colSum(data.rows, c.key)
    return (
      <td key={c.key} className="cst-amt">
        {v ? (
          <button type="button" className="cbs-sum" onClick={() => setDetail(c)}>
            {money(v)}
          </button>
        ) : (
          ''
        )}
      </td>
    )
  }
  const blanks = data.columns.map((c) => <td key={c.key} />)
  const behind = detail ? data.rows.filter((r) => r.cells[detail.key]) : []

  return (
    <section className="cbs-side">
      <div className="cbs-side-head">
        <h3>{income ? tx('আয়') : tx('ব্যয়')}</h3>
        {!printing && pages > 1 && <span className="no-print">{tx('পৃষ্ঠা {{p0}}/{{p1}}', { p0: digits(page), p1: digits(pages) })}</span>}
      </div>
      <div className="cbs-scroll">
        <table className="cst-table cbs-table">
          <thead>
            <tr>
              <th>{tx('তারিখ')}</th>
              <th>{income ? tx('রশিদ নং') : tx('ভাউচার নং')}</th>
              <th>{income ? tx('কার কাছ থেকে') : tx('ব্যয়ের খাত / কাকে')}</th>
              {data.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>{tx('মোট')}</th>
              <th>{tx('দিনের মোট')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols + 5} className="cbs-empty">
                  {income ? tx('এই সময়ে কোনো আয় নেই') : tx('এই সময়ে কোনো ব্যয় নেই')}
                </td>
              </tr>
            )}
            {shown.map((r, i) => {
              const n = span(i)
              return (
                <tr key={r.id}>
                  {n > 0 && (
                    <td rowSpan={n} className="cbs-date">
                      {fmtDate(r.date)}
                    </td>
                  )}
                  <td className="cbs-ref">{ref(r)}</td>
                  <td className="cbs-party">{r.party}</td>
                  {data.columns.map((c) => (
                    <td key={c.key} className="cst-amt">
                      {amt(r.cells[c.key])}
                    </td>
                  ))}
                  <td className="cst-amt cbs-strong">{money(r.total)}</td>
                  {n > 0 && (
                    <td rowSpan={n} className="cst-amt cbs-strong">
                      {money(dayTotal[r.date])}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="cst-total">
              <td colSpan={3}>{income ? tx('মোট আয়') : tx('মোট ব্যয়')} =</td>
              {data.columns.map(totalCell)}
              <td className="cst-amt">{money(data.total)}</td>
              <td />
            </tr>
            <tr className="cst-total">
              <td colSpan={3}>{income ? tx('পূর্ববর্তী জের') : tx('হাতে নগদ জের')} =</td>
              {blanks}
              <td className="cst-amt">{money(income ? opening : closing)}</td>
              <td />
            </tr>
            <tr className="cst-total">
              <td colSpan={3}>{income ? tx('সর্বমোট আয়') : tx('সর্বমোট ব্যয়')} =</td>
              {blanks}
              <td className="cst-amt">{money(data.total + (income ? opening : closing))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {!printing && pages > 1 && <Pagination className="no-print cbs-pager" size="small" current={page} pageSize={PER_PAGE} total={data.rows.length} onChange={setPage} showSizeChanger={false} />}

      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} width={640} title={detail ? `${detail.label} — ${money(colSum(data.rows, detail.key))}` : ''}>
        <table className="cst-table cbs-detail">
          <thead>
            <tr>
              <th>{tx('তারিখ')}</th>
              <th>{income ? tx('রশিদ নং') : tx('ভাউচার নং')}</th>
              <th>{income ? tx('কার কাছ থেকে') : tx('ব্যয়ের খাত / কাকে')}</th>
              <th>{tx('টাকা')}</th>
            </tr>
          </thead>
          <tbody>
            {behind.map((r) => (
              <tr key={r.id}>
                <td className="cbs-date">{fmtDate(r.date)}</td>
                <td className="cbs-ref">{ref(r)}</td>
                <td>{r.party}</td>
                <td className="cst-amt">{money(detail ? r.cells[detail.key] : 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </section>
  )
}
