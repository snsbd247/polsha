import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppstoreFilled, DollarCircleFilled, FallOutlined, PieChartFilled, ToolFilled, UnorderedListOutlined, WalletFilled } from '@ant-design/icons'
import ReportHub from '../../components/ReportHub'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { t as tx } from '../../lib/i18n'

type Totals = { totals: { count: number; cost: number; accumulated: number; book_value: number } }

/** The asset reports (register, by category, depreciation, maintenance) with the register totals above; each can be filtered, printed and exported. */
export default function AssetReportsPage() {
  const navigate = useNavigate()
  const { data: d } = useQuery({ queryKey: ['asset-dashboard'], queryFn: async () => (await api.get<Totals>('/assets/dashboard')).data })

  const cards = [
    { key: 'count', label: tx('চালু সম্পদ'), value: d?.totals.count, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/assets') },
    { key: 'cost', label: tx('ক্রয়মূল্য'), value: d ? `৳ ${money(d.totals.cost)}` : undefined, icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'acc', label: tx('পুঞ্জীভূত অবচয়'), value: d ? `৳ ${money(d.totals.accumulated)}` : undefined, icon: '', glyph: <FallOutlined />, color: '#e5383b', tint: '#fde4e5' },
    { key: 'book', label: tx('বর্তমান মূল্য'), value: d ? `৳ ${money(d.totals.book_value)}` : undefined, icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5' },
  ]

  return (
    <ReportHub
      section={{ label: tx('সম্পদ'), to: '/assets/dashboard' }}
      title={tx('সম্পদের রিপোর্ট')}
      cards={cards}
      reports={[
        { key: 'asset_register', icon: <UnorderedListOutlined /> },
        { key: 'asset_by_category', icon: <PieChartFilled /> },
        { key: 'asset_depreciation', icon: <FallOutlined /> },
        { key: 'asset_maintenance', icon: <ToolFilled /> },
      ]}
    />
  )
}
