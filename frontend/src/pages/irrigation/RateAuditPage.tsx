import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Select, Space, Table, Tag } from 'antd'
import { money } from '../../lib/accounting'
import { api } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { RATE_STATUS_COLOR, useInvoiceMeta } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'

type User = { id: number; name_bn: string; name_en: string | null } | null
type InvoiceIssue = {
  id: number
  invoice_no: string
  name: string
  dag_no: string
  area_decimal: number
  rate: number
  amount: number
  current_rate: number | null
  expected: number | null
  problems: string[]
}
type NoRate = { land_type: string | null; irrigation_type: string | null; lands: number; area: number }
type Change = {
  id: number
  irrigation_type_name: string
  land_type_name: string | null
  rate: string
  effective_from: string
  status: string
  reason: string | null
  created_at: string
  approval_request_id: number | null
  invoices: number
  creator: User
  approver: User
}
type Resp = {
  invoice_issues: InvoiceIssue[]
  no_rate: NoRate[]
  lands_without_irrigation_type: number
  changes: Change[]
  problems: Record<string, string>
  statuses: Record<string, string>
}

const allLands = (v: string | null) => v || tx('সব ধরনের জমি')

export default function RateAuditPage() {
  const [params, setParams] = useSearchParams()
  const { data: meta } = useInvoiceMeta()
  const seasonId = Number(params.get('season_id')) || meta?.seasons.find((s) => s.status === 'open')?.id || meta?.seasons[0]?.id

  const { data, isLoading } = useQuery({
    queryKey: ['rate-audit', seasonId],
    queryFn: async () => (await api.get<Resp>('/irrigation/rate-audit', { params: { season_id: seasonId } })).data,
    enabled: !!seasonId,
  })
  const clean = data && !data.invoice_issues.length && !data.no_rate.length && !data.lands_without_irrigation_type

  return (
    <>
      <div className="page-header">
        <h2>{tx('রেট অডিট')}</h2>
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={seasonId}
            placeholder={tx('মৌসুম')}
            options={meta?.seasons.map((s) => ({ value: s.id, label: s.name_bn }))}
            onChange={(v) => setParams({ season_id: String(v) })}
          />
        </Space>
      </div>
      {clean && <Alert type="success" showIcon style={{ marginBottom: 16 }} title={tx('এই মৌসুমের সব ইনভয়েস অনুমোদিত রেট অনুযায়ী, এবং সব চাষকৃত জমির রেট আছে।')} />}
      {!!data?.lands_without_irrigation_type && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('{{p0}}টি চাষকৃত জমিতে সেচের ধরন দেওয়া নেই — এগুলোর ইনভয়েস হবে না।', { p0: digits(data.lands_without_irrigation_type) })}
        />
      )}

      <Card title={tx('রেটের সাথে না মেলা ইনভয়েস')} style={{ marginBottom: 16 }}>
        <Table<InvoiceIssue>
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.invoice_issues}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          locale={{ emptyText: tx('কোনো সমস্যা নেই') }}
          scroll={{ x: 1000 }}
          columns={[
            { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`}>{digits(v)}</Link> },
            { title: tx('চাষি'), dataIndex: 'name' },
            { title: tx('দাগ'), dataIndex: 'dag_no', render: (v: string) => digits(v) },
            { title: tx('শতক'), dataIndex: 'area_decimal', align: 'right', render: (v: number) => digits(v) },
            { title: tx('বিলের রেট'), dataIndex: 'rate', align: 'right', render: money },
            { title: tx('অনুমোদিত রেট'), dataIndex: 'current_rate', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
            { title: tx('বিল'), dataIndex: 'amount', align: 'right', render: money },
            { title: tx('হওয়া উচিত'), dataIndex: 'expected', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
            {
              title: tx('সমস্যা'),
              dataIndex: 'problems',
              render: (ps: string[]) =>
                ps.map((p) => (
                  <Tag key={p} color="red">
                    {data?.problems[p] ?? p}
                  </Tag>
                )),
            },
          ]}
        />
      </Card>

      <Card title={tx('রেট নেই এমন জমি')} style={{ marginBottom: 16 }}>
        <Table<NoRate>
          rowKey={(r) => `${r.land_type}-${r.irrigation_type}`}
          size="small"
          loading={isLoading}
          dataSource={data?.no_rate}
          pagination={false}
          locale={{ emptyText: tx('সব চাষকৃত জমির রেট আছে') }}
          columns={[
            { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type' },
            { title: tx('জমির ধরন'), dataIndex: 'land_type', render: allLands },
            { title: tx('জমি'), dataIndex: 'lands', align: 'right', render: (v: number) => digits(v) },
            { title: tx('শতক'), dataIndex: 'area', align: 'right', render: (v: number) => digits(v) },
          ]}
        />
      </Card>

      <Card title={tx('রেট পরিবর্তনের লগ')}>
        <Table<Change>
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.changes}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          scroll={{ x: 1100 }}
          columns={[
            { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type_name' },
            { title: tx('জমির ধরন'), dataIndex: 'land_type_name', render: allLands },
            { title: tx('রেট'), dataIndex: 'rate', align: 'right', render: money },
            { title: tx('কার্যকর তারিখ'), dataIndex: 'effective_from', render: fmtDate },
            {
              title: tx('অবস্থা'),
              dataIndex: 'status',
              render: (v: string, r) => {
                const tag = <Tag color={RATE_STATUS_COLOR[v]}>{data?.statuses[v] ?? v}</Tag>
                return r.approval_request_id ? <Link to={`/approvals/${r.approval_request_id}`}>{tag}</Link> : tag
              },
            },
            { title: tx('ইনভয়েস'), dataIndex: 'invoices', align: 'right', render: (v: number) => digits(v) },
            { title: tx('কারণ'), dataIndex: 'reason', ellipsis: true },
            { title: tx('প্রস্তাবকারী'), render: (_, r) => nameOf(r.creator) },
            { title: tx('অনুমোদনকারী'), render: (_, r) => nameOf(r.approver) || '—' },
            { title: tx('প্রস্তাবের সময়'), dataIndex: 'created_at', render: fmtDateTime },
          ]}
        />
      </Card>
    </>
  )
}
