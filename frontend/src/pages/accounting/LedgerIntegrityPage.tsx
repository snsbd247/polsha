import { useQuery } from '@tanstack/react-query'
import { Button, Spin, Table, Tag } from 'antd'
import { CheckOutlined, ClockCircleFilled, ReloadOutlined, SafetyCertificateFilled, SwapOutlined, WarningFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import IntegrityResults, { type IntegrityCheck } from '../../components/IntegrityResults'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import dayjs from 'dayjs'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import './accounting.css'

type SourceRow = { item: string; account: string; source: number; ledger: number; difference: number }
type Ledger = { checks: IntegrityCheck[]; source_vs_ledger: SourceRow[]; checked_at: string }

export function SourceVsLedgerTable({ rows, loading }: { rows?: SourceRow[]; loading?: boolean }) {
  return (
    <Table<SourceRow>
      rowKey="item"
      size="small"
      className="id-payments"
      loading={loading}
      pagination={false}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: tx('বিষয়'), dataIndex: 'item' },
        { title: tx('নিয়ন্ত্রণ হিসাব'), dataIndex: 'account' },
        { title: tx('মডিউলের হিসাব (৳)'), dataIndex: 'source', align: 'right', render: money },
        { title: tx('খতিয়ান (৳)'), dataIndex: 'ledger', align: 'right', render: money },
        {
          title: tx('পার্থক্য'),
          dataIndex: 'difference',
          align: 'right',
          render: (v: number) => (Math.abs(v) >= 0.01 ? <Tag className="fl-tag fl-tag-red">{money(v)}</Tag> : <Tag className="fl-tag fl-tag-green">{tx('মিলেছে')}</Tag>),
        },
      ]}
    />
  )
}

/** Live ledger checks: balanced vouchers, every source record posted, module totals = control accounts. */
export default function LedgerIntegrityPage() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ledger-integrity'],
    queryFn: async () => (await api.get<Ledger>('/ledger-integrity')).data,
  })
  const failed = data?.checks.filter((c) => c.count > 0) ?? []
  const errors = failed.filter((c) => c.severity === 'error').length
  const mismatched = data?.source_vs_ledger.filter((r) => Math.abs(r.difference) >= 0.01).length ?? 0

  const cards = [
    { key: 'ok', label: tx('যাচাই পাস · মোট {{p0}}টি', { p0: n0(data?.checks.length ?? 0) }), value: data ? data.checks.length - failed.length : undefined, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'bad', label: tx('গুরুতর অসঙ্গতি'), value: data ? errors : undefined, icon: '', glyph: <WarningFilled />, color: errors ? '#e5383b' : '#1f9d55', tint: errors ? '#fde4e5' : '#dcf3e5' },
    { key: 'src', label: tx('উৎস বনাম খতিয়ানে অমিল'), value: data ? mismatched : undefined, icon: '', glyph: <SwapOutlined />, color: mismatched ? '#f08c00' : '#1769e0', tint: mismatched ? '#fdefd6' : '#e4edfd' },
    {
      key: 'at',
      label: data ? tx('সর্বশেষ যাচাই · {{p0}}', { p0: fmtDate(data.checked_at) }) : tx('সর্বশেষ যাচাই'),
      value: data ? digits(dayjs(data.checked_at).format('hh:mm A')) : undefined,
      icon: '',
      glyph: <ClockCircleFilled />,
      color: '#8b3fe0',
      tint: '#efe4fc',
    },
  ]

  return (
    <PageFrame
      className="ml pl id-page"
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: tx('লেজার সঠিকতা') }]}
      title={tx('লেজার সঠিকতা')}
      actions={
        <Button type="primary" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          {tx('আবার যাচাই')}
        </Button>
      }
    >
      <StatRow cards={cards} className="li-cards" />
      {!data ? (
        <Spin />
      ) : (
        <>
          <Box icon={<SafetyCertificateFilled />} title={tx('ভাউচার ও পোস্টিং যাচাই')} className="li-box">
            <div className="li-body">
              <IntegrityResults checks={data.checks} />
            </div>
          </Box>
          <Box icon={<SwapOutlined />} title={tx('উৎস বনাম খতিয়ান')} className="li-box">
            <SourceVsLedgerTable rows={data.source_vs_ledger} loading={isFetching} />
          </Box>
        </>
      )}
    </PageFrame>
  )
}
