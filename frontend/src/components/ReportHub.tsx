import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Result, Spin } from 'antd'
import { BarChartOutlined, DollarCircleFilled, FileTextFilled, PieChartFilled, UnorderedListOutlined } from '@ant-design/icons'
import PageFrame from './PageFrame'
import ReportView from './ReportView'
import { money } from '../lib/accounting'
import { useReportCatalog, type ReportResult } from '../lib/reports'
import { t as tx } from '../lib/i18n'
import { Box } from '../pages/irrigation/InvoiceDetailPage'
import { StatRow, type StatCard } from '../pages/lands/ListFrame'
import '../pages/lands/land-list.css'
import '../pages/irrigation/invoice-detail.css'
import '../pages/irrigation/rates.css'
import '../pages/approvals/approvals.css'
import '../pages/loans/loans.css'
import '../pages/assets/assets.css'

const TONES = [
  { color: '#1769e0', tint: '#e4edfd', glyph: <FileTextFilled /> },
  { color: '#1f9d55', tint: '#dcf3e5', glyph: <DollarCircleFilled /> },
  { color: '#8b3fe0', tint: '#efe4fc', glyph: <PieChartFilled /> },
  { color: '#f08c00', tint: '#fdefd6', glyph: <BarChartOutlined /> },
]

/** The figures of a report as cards: the row count, then its summary lines — or, without a summary, the totals of its summed columns. */
function cardsOf(r: ReportResult | null): StatCard[] {
  if (!r) return TONES.map((t, i) => ({ key: `x${i}`, label: '', value: undefined, icon: '', ...t }))
  const fromSummary = r.summary.map((s) => ({ label: s.label, value: s.type === 'money' ? `৳ ${money(Number(s.value))}` : typeof s.value === 'number' ? s.value : String(s.value) }))
  const fromTotals = r.columns
    .filter((c) => c.sum && r.totals[c.key] !== undefined)
    .map((c) => ({ label: tx('মোট {{p0}}', { p0: c.label }), value: c.type === 'money' || c.type === 'decimal' ? `৳ ${money(r.totals[c.key])}` : r.totals[c.key] }))
  const items = (fromSummary.length ? fromSummary : fromTotals).slice(0, 3).map((s, i) => ({ key: `s${i}`, ...s, icon: '', ...TONES[(i + 1) % TONES.length] }))
  return [{ key: 'rows', label: tx('মোট সারি'), value: r.rows.length, icon: '', ...TONES[0] }, ...items]
}

/**
 * A menu page made of one or more registry reports, in the approved page frame:
 * breadcrumb, summary cards, a tab per report and the report (filters, table, print, export) in a box.
 * Cards come from the open report's own summary unless the page gives its own.
 */
export default function ReportHub({ section, title, reports, cards, note }: { section: { label: string; to: string }; title: string; reports: { key: string; icon?: ReactNode }[]; cards?: StatCard[]; note?: ReactNode }) {
  const [search, setSearch] = useSearchParams()
  const { data: catalog, isLoading } = useReportCatalog()
  const [result, setResult] = useState<ReportResult | null>(null)
  const allowed = reports.filter((r) => catalog?.reports.some((c) => c.key === r.key))
  const active = allowed.find((r) => r.key === search.get('tab'))?.key ?? allowed[0]?.key
  const titleOf = (key: string) => catalog?.reports.find((r) => r.key === key)?.title ?? key
  const shown = cards ?? cardsOf(result?.key === active ? result : null)

  return (
    <PageFrame className="ml pl id-page" crumbs={[section, { label: title }]} title={title}>
      {isLoading ? (
        <Spin />
      ) : !active ? (
        <Result status="403" title={tx('অনুমতি নেই')} subTitle={tx('এই রিপোর্ট দেখার অনুমতি আপনার নেই।')} />
      ) : (
        <>
          <StatRow cards={shown} />
          {note}
          {allowed.length > 1 && (
            <div className="lk-tabs ap-tabs as-report-tabs">
              {allowed.map((r) => (
                <button key={r.key} type="button" className={active === r.key ? 'on' : ''} onClick={() => setSearch({ tab: r.key }, { replace: true })}>
                  {r.icon ?? <UnorderedListOutlined />} {titleOf(r.key)}
                </button>
              ))}
            </div>
          )}
          <Box icon={<FileTextFilled />} title={titleOf(active)} className={`as-report ${allowed.length > 1 ? '' : 'rh-single'}`}>
            <ReportView key={active} reportKey={active} onData={setResult} />
          </Box>
        </>
      )}
    </PageFrame>
  )
}
