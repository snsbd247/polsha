import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Result, Spin } from 'antd'
import { AppstoreFilled, DollarCircleFilled, FallOutlined, FileTextFilled, PieChartFilled, ToolFilled, UnorderedListOutlined, WalletFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import ReportView from '../../components/ReportView'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { useReportCatalog } from '../../lib/reports'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoice-detail.css'
import '../irrigation/rates.css'
import '../approvals/approvals.css'
import '../loans/loans.css'
import './assets.css'

type Totals = { totals: { count: number; cost: number; accumulated: number; book_value: number } }

const REPORTS: { key: string; icon: ReactNode }[] = [
  { key: 'asset_register', icon: <UnorderedListOutlined /> },
  { key: 'asset_by_category', icon: <PieChartFilled /> },
  { key: 'asset_depreciation', icon: <FallOutlined /> },
  { key: 'asset_maintenance', icon: <ToolFilled /> },
]

/** The asset reports (register, by category, depreciation, maintenance) with the register totals above; each can be filtered, printed and exported. */
export default function AssetReportsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const { data: catalog, isLoading } = useReportCatalog()
  const { data: d } = useQuery({ queryKey: ['asset-dashboard'], queryFn: async () => (await api.get<Totals>('/assets/dashboard')).data })
  const allowed = REPORTS.filter((r) => catalog?.reports.some((c) => c.key === r.key))
  const active = allowed.find((r) => r.key === search.get('tab'))?.key ?? allowed[0]?.key
  const titleOf = (key: string) => catalog?.reports.find((r) => r.key === key)?.title ?? key

  const cards = [
    { key: 'count', label: tx('চালু সম্পদ'), value: d?.totals.count, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/assets') },
    { key: 'cost', label: tx('ক্রয়মূল্য'), value: d ? `৳ ${money(d.totals.cost)}` : undefined, icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'acc', label: tx('পুঞ্জীভূত অবচয়'), value: d ? `৳ ${money(d.totals.accumulated)}` : undefined, icon: '', glyph: <FallOutlined />, color: '#e5383b', tint: '#fde4e5' },
    { key: 'book', label: tx('বর্তমান মূল্য'), value: d ? `৳ ${money(d.totals.book_value)}` : undefined, icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5' },
  ]

  return (
    <PageFrame className="ml pl id-page" crumbs={[{ label: tx('সম্পদ'), to: '/assets/dashboard' }, { label: tx('সম্পদের রিপোর্ট') }]} title={tx('সম্পদের রিপোর্ট')}>
      <StatRow cards={cards} />
      {isLoading ? (
        <Spin />
      ) : !active ? (
        <Result status="403" title={tx('অনুমতি নেই')} subTitle={tx('এই রিপোর্ট দেখার অনুমতি আপনার নেই।')} />
      ) : (
        <>
          <div className="lk-tabs ap-tabs as-report-tabs">
            {allowed.map((r) => (
              <button key={r.key} type="button" className={active === r.key ? 'on' : ''} onClick={() => setSearch({ tab: r.key }, { replace: true })}>
                {r.icon} {titleOf(r.key)}
              </button>
            ))}
          </div>
          <Box icon={<FileTextFilled />} title={titleOf(active)} className="as-report">
            <ReportView key={active} reportKey={active} />
          </Box>
        </>
      )}
    </PageFrame>
  )
}
