import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Col, Row, Statistic, Table, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Issue = { kind: string; loan_id?: number; payment_id?: number; ref: string; name: string | null; expected: number; actual: number | null }
type Resp = {
  book_balance: number
  ledger_balance: number
  difference: number
  loans: number
  account: { id: number; code: string; name_bn: string; name_en: string | null }
  interest_income: number
  penalty_income: number
  issues: Issue[]
  kinds: Record<string, string>
}

/** Loan audit: schedule principal vs the loans receivable ledger, plus payment/voucher checks. */
export default function LoanAuditPage() {
  const { data, isFetching, refetch } = useQuery({ queryKey: ['loan-audit'], queryFn: async () => (await api.get<Resp>('/loans/audit')).data })
  const ok = data && data.difference === 0 && data.issues.length === 0

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('ঋণ'), to: '/loans' }, { label: tx('ঋণ অডিট') }]}
      title={tx('ঋণ অডিট')}
      actions={
        <span className="id-actions no-print">
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
            {tx('আবার যাচাই')}
          </Button>
        </span>
      }
    >
      {data && (
        <Alert
          type={ok ? 'success' : 'error'}
          showIcon
          style={{ marginBottom: 16 }}
          title={ok ? tx('{{p0}}টি ঋণের কিস্তি, পরিশোধ ও লেজার সম্পূর্ণ মিলে গেছে।', { p0: digits(data.loans) }) : tx('অমিল পাওয়া গেছে — নিচের তালিকা দেখে ঠিক করুন।')}
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('কিস্তির তালিকায় আসল বাকি')} value={money(data?.book_balance)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('লেজারে জের ({{p0}})', { p0: data ? accountLabel(data.account) : '' })} value={money(data?.ledger_balance)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('পার্থক্য')} value={money(data?.difference)} prefix="৳" styles={{ content: { color: data?.difference ? '#cf1322' : '#389e0d' } }} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={tx('সুদ আয় (লেজার)')} value={money(data?.interest_income)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={tx('জরিমানা আয় (লেজার)')} value={money(data?.penalty_income)} prefix="৳" />
          </Card>
        </Col>
      </Row>
      <Card title={tx('অমিলের তালিকা')}>
        <Table<Issue>
          rowKey={(r) => `${r.kind}-${r.loan_id ?? 'p' + r.payment_id}-${r.expected}`}
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
              render: (v: string, r) => <Link to={r.loan_id ? `/loans/${r.loan_id}` : `/loans/payments/${r.payment_id}`}>{digits(v)}</Link>,
            },
            { title: tx('বিবরণ'), dataIndex: 'name', render: (v) => (v ? digits(v) : '') },
            { title: tx('প্রত্যাশিত'), dataIndex: 'expected', align: 'right', render: money },
            { title: tx('প্রকৃত'), dataIndex: 'actual', align: 'right', render: (v) => (v === null ? '—' : money(v)) },
          ]}
        />
      </Card>
    </PageFrame>
  )
}
