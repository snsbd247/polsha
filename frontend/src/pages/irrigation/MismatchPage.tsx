import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Row, Statistic, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'

type Issue = { kind: string; invoice_id?: number; receipt_id?: number; ref: string; name: string; expected: number; actual: number | null }
type Resp = {
  ledger_due: number
  book_due: number
  difference: number
  account: { id: number; code: string; name_bn: string; name_en: string | null }
  issues: Issue[]
  kinds: Record<string, string>
}

export default function MismatchPage() {
  const { data, isFetching, refetch } = useQuery({ queryKey: ['irrigation-mismatch'], queryFn: async () => (await api.get<Resp>('/irrigation/mismatch')).data })
  const ok = data && data.difference === 0 && data.issues.length === 0

  return (
    <>
      <div className="page-header">
        <h2>{tx('বকেয়া মিলকরণ (Due Mismatch)')}</h2>
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          {tx('আবার যাচাই')}
        </Button>
      </div>
      {data && (
        <Alert
          type={ok ? 'success' : 'error'}
          showIcon
          style={{ marginBottom: 16 }}
          title={ok ? tx('ইনভয়েস, রশিদ ও লেজার সম্পূর্ণ মিলে গেছে।') : tx('অমিল পাওয়া গেছে — নিচের তালিকা দেখে ঠিক করুন।')}
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('লেজারে বকেয়া ({{p0}})', { p0: data ? accountLabel(data.account) : '' })} value={money(data?.ledger_due)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('ইনভয়েস অনুযায়ী বকেয়া')} value={money(data?.book_due)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('পার্থক্য')} value={money(data?.difference)} prefix="৳" styles={{ content: { color: data?.difference ? '#cf1322' : '#389e0d' } }} />
          </Card>
        </Col>
      </Row>
      <Card title={tx('অমিলের তালিকা')}>
        <Table<Issue>
          rowKey={(r) => `${r.kind}-${r.invoice_id ?? r.receipt_id}`}
          size="small"
          loading={isFetching}
          dataSource={data?.issues}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          locale={{ emptyText: tx('কোনো অমিল নেই') }}
          columns={[
            { title: tx('সমস্যা'), dataIndex: 'kind', render: (k: string) => <Tag color="red">{data?.kinds[k] ?? k}</Tag> },
            {
              title: tx('রেফারেন্স'),
              dataIndex: 'ref',
              render: (v: string, r) =>
                r.invoice_id ? <Link to={`/irrigation/invoices/${r.invoice_id}`}>{digits(v)}</Link> : <Link to={`/payments/receipts/${r.receipt_id}`}>{digits(v)}</Link>,
            },
            { title: tx('নাম'), dataIndex: 'name' },
            { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: money },
            { title: tx('বর্তমান'), dataIndex: 'actual', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
          ]}
        />
      </Card>
    </>
  )
}
