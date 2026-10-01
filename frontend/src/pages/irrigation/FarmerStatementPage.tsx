import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Col, Descriptions, Row, Space, Spin, Statistic, Table, Tag } from 'antd'
import { DollarOutlined, PrinterOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { INVOICE_STATUS_COLOR, METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, useInvoiceMeta, type Person } from '../../lib/irrigation'
import { CULTIVATION_COLOR } from '../../lib/land'
import { nameOf, t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Inv = {
  id: number
  invoice_no: string
  invoice_date: string
  season: string | null
  mouza: string | null
  dag_no: string | null
  cultivation_type: string
  area_decimal: number
  amount: number
  paid_amount: number
  due: number
  status: string
}
type Rec = { id: number; receipt_no: string; date: string; amount: string; method: string; status: string; is_legacy: boolean; legacy_no: string | null }
type Statement = { farmer: Person; invoices: Inv[]; receipts: Rec[]; totals: { amount: number; paid: number; due: number } }

export type { Statement }

export default function FarmerStatementPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['irrigation-statement', id],
    queryFn: async () => (await api.get<Statement>(`/irrigation/farmers/${id}/statement`)).data,
  })
  if (isLoading || !data) return <Spin />
  const f = data.farmer

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচ হিসাব বিবরণী') }]}
      title={tx('সেচ হিসাব বিবরণী')}
      actions={
        <span className="id-actions no-print">
          <Space wrap className="no-print">
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              {tx('প্রিন্ট')}
            </Button>
            {can('payment.create') && data.totals.due > 0 && (
              <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate(`/payments/collect?farmer_id=${f.id}`)}>
                {tx('টাকা আদায়')}
              </Button>
            )}
          </Space>
        </span>
      }
    >
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, md: 4 }} size="small">
          <Descriptions.Item label={tx('নাম')}>{can('farmer.view') ? <Link to={`/farmers/${f.id}`}>{nameOf(f)}</Link> : nameOf(f)}</Descriptions.Item>
          <Descriptions.Item label={tx('কৃষক আইডি')}>{digits(f.farmer_code)}</Descriptions.Item>
          <Descriptions.Item label={tx('পিতা')}>{f.father_name}</Descriptions.Item>
          <Descriptions.Item label={tx('মোবাইল')}>{f.mobile ? digits(f.mobile) : '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <StatementTables data={data} />
    </PageFrame>
  )
}

/** Totals, invoices and receipts of one farmer — also shown inside the farmer profile. */
export function StatementTables({ data }: { data: Statement }) {
  const { data: meta } = useInvoiceMeta()
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('মোট বিল')} value={money(data.totals.amount)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('আদায়')} value={money(data.totals.paid)} prefix="৳" styles={{ content: { color: '#389e0d' } }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('বকেয়া')} value={money(data.totals.due)} prefix="৳" styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
      </Row>
      <Card title={tx('ইনভয়েস ইতিহাস')} style={{ marginBottom: 16 }}>
        <Table<Inv>
          rowKey="id"
          size="small"
          dataSource={data.invoices}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`}>{digits(v)}</Link> },
            { title: tx('তারিখ'), dataIndex: 'invoice_date', render: fmtDate },
            { title: tx('মৌসুম'), dataIndex: 'season' },
            { title: tx('মৌজা / দাগ'), render: (_, r) => `${r.mouza ?? ''} / ${digits(r.dag_no)}` },
            { title: tx('চাষ'), dataIndex: 'cultivation_type', render: (v: string) => <Tag color={CULTIVATION_COLOR[v]}>{meta?.cultivation_types[v] ?? v}</Tag> },
            { title: tx('শতক'), dataIndex: 'area_decimal', align: 'right', render: (v: number) => digits(v) },
            { title: tx('বিল'), dataIndex: 'amount', align: 'right', render: money },
            { title: tx('আদায়'), dataIndex: 'paid_amount', align: 'right', render: money },
            { title: tx('বকেয়া'), dataIndex: 'due', align: 'right', render: (v: number, r) => (r.status === 'cancelled' ? '—' : <span style={{ color: v > 0 ? '#cf1322' : undefined }}>{money(v)}</span>) },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={INVOICE_STATUS_COLOR[s]}>{meta?.statuses[s] ?? s}</Tag> },
          ]}
        />
      </Card>
      <Card title={tx('রশিদ')}>
        <Table<Rec>
          rowKey="id"
          size="small"
          dataSource={data.receipts}
          pagination={false}
          columns={[
            { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, r) => <Link to={`/payments/receipts/${r.id}`}>{digits(v)}</Link> },
            { title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', render: (v) => (v ? digits(v) : '') },
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => METHOD_LABEL[v] ?? v },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={RECEIPT_STATUS_COLOR[s]}>{RECEIPT_STATUS_LABEL[s] ?? s}</Tag> },
          ]}
        />
      </Card>
    </>
  )
}
