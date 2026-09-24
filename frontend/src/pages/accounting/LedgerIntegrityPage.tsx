import { useQuery } from '@tanstack/react-query'
import { Button, Card, Spin, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { fmtDateTime } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import IntegrityResults, { type IntegrityCheck } from '../../components/IntegrityResults'

type SourceRow = { item: string; account: string; source: number; ledger: number; difference: number }
type Ledger = { checks: IntegrityCheck[]; source_vs_ledger: SourceRow[]; checked_at: string }

export function SourceVsLedgerTable({ rows, loading }: { rows?: SourceRow[]; loading?: boolean }) {
  return (
    <Table<SourceRow>
      rowKey="item"
      size="small"
      loading={loading}
      pagination={false}
      dataSource={rows}
      scroll={{ x: 700 }}
      columns={[
        { title: tx('বিষয়'), dataIndex: 'item' },
        { title: tx('নিয়ন্ত্রণ হিসাব'), dataIndex: 'account' },
        { title: tx('মডিউলের হিসাব'), dataIndex: 'source', align: 'right', render: money },
        { title: tx('খতিয়ান'), dataIndex: 'ledger', align: 'right', render: money },
        {
          title: tx('পার্থক্য'),
          dataIndex: 'difference',
          align: 'right',
          render: (v: number) => (Math.abs(v) >= 0.01 ? <Tag color="red">{money(v)}</Tag> : <Tag color="green">{tx('মিলেছে')}</Tag>),
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

  return (
    <>
      <div className="page-header">
        <h2>{tx('লেজার সঠিকতা যাচাই')}</h2>
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          {tx('আবার যাচাই')}
        </Button>
      </div>
      {!data ? (
        <Spin />
      ) : (
        <>
          <p style={{ color: '#888' }}>{tx('যাচাইয়ের সময়: {{d}}', { d: fmtDateTime(data.checked_at) })}</p>
          <Card size="small" title={tx('ভাউচার ও পোস্টিং যাচাই')} style={{ marginBottom: 16 }}>
            <IntegrityResults checks={data.checks} />
          </Card>
          <Card size="small" title={tx('উৎস বনাম খতিয়ান')}>
            <SourceVsLedgerTable rows={data.source_vs_ledger} loading={isFetching} />
          </Card>
        </>
      )}
    </>
  )
}
