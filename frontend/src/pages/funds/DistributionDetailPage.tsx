import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { App, Button, Card, Descriptions, Space, Spin, Table, Tag } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { RUN_STATUS_COLOR, type MemberBrief } from '../../lib/funds'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import type { RunRow } from './DistributionListPage'

type Item = { id: number; member_id: number; basis: string; amount: string; member: (MemberBrief & { farmer: MemberBrief['farmer'] & { father_name: string } }) | null; transaction: { id: number; txn_no: string } | null }
type Detail = RunRow & {
  posted_at: string | null
  items: Item[]
  journal: { id: number; voucher_no: string; status: string } | null
  kinds: Record<string, string>
  statuses: Record<string, string>
}

export default function DistributionDetailPage() {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const { data: r, isLoading } = useQuery({ queryKey: ['distributions', id], queryFn: async () => (await api.get<Detail>(`/distributions/${id}`)).data })
  if (isLoading || !r) return <Spin />

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('বণ্টন {{p0}}', { p0: digits(r.run_no) })} <Tag color={RUN_STATUS_COLOR[r.status]}>{r.statuses[r.status] ?? r.status}</Tag>
        </h2>
        <Space wrap>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport(`/distributions/${r.id}`, { export: 'csv' }, `${r.run_no}.csv`).catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
        </Space>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, md: 3 }} size="small" title={r.title}>
          <Descriptions.Item label={tx('ধরন')}>{r.kinds[r.kind] ?? r.kind}</Descriptions.Item>
          <Descriptions.Item label={tx('তারিখ')}>{fmtDate(r.date)}</Descriptions.Item>
          {r.basis_date && <Descriptions.Item label={tx('ভিত্তি তারিখ')}>{fmtDate(r.basis_date)}</Descriptions.Item>}
          {r.pool_amount && <Descriptions.Item label={tx('মোট লভ্যাংশ')}>৳{money(r.pool_amount)}</Descriptions.Item>}
          <Descriptions.Item label={tx('মোট বণ্টন')}>৳{money(r.total_amount)}</Descriptions.Item>
          <Descriptions.Item label={tx('সদস্য সংখ্যা')}>{digits(r.items.length)}</Descriptions.Item>
          <Descriptions.Item label={tx('তৈরি করেছেন')}>{nameOf(r.creator)}</Descriptions.Item>
          {r.posted_at && <Descriptions.Item label={tx('পোস্টিংয়ের সময়')}>{fmtDateTime(r.posted_at)}</Descriptions.Item>}
          {r.journal && (
            <Descriptions.Item label={tx('ভাউচার')}>
              {can('accounting.view') ? <Link to={`/accounting/journals/${r.journal.id}`}>{digits(r.journal.voucher_no)}</Link> : digits(r.journal.voucher_no)}
            </Descriptions.Item>
          )}
          {r.approval_request_id && (
            <Descriptions.Item label={tx('অনুমোদন')} className="no-print">
              <Link to={`/approvals/${r.approval_request_id}`}>{tx('অনুরোধ দেখুন')}</Link>
            </Descriptions.Item>
          )}
          {r.remarks && <Descriptions.Item label={tx('মন্তব্য')}>{r.remarks}</Descriptions.Item>}
        </Descriptions>
      </Card>
      <Table<Item>
        rowKey="id"
        size="small"
        dataSource={r.items}
        pagination={{ pageSize: 100, hideOnSinglePage: true }}
        columns={[
          { title: tx('সদস্য নং'), width: 90, render: (_, i) => digits(i.member?.member_no) },
          { title: tx('নাম'), render: (_, i) => nameOf(i.member?.farmer) },
          { title: tx('পিতার নাম'), render: (_, i) => i.member?.farmer?.father_name },
          { title: r.kind === 'profit' ? tx('সঞ্চয় জের') : tx('শেয়ার জের'), dataIndex: 'basis', width: 140, align: 'right', render: money },
          { title: r.kind === 'profit' ? tx('মুনাফা') : tx('লভ্যাংশ'), dataIndex: 'amount', width: 140, align: 'right', render: money },
          {
            title: tx('লেনদেন নং'),
            width: 150,
            render: (_, i) => (i.transaction ? <Link to={`/funds/savings/transactions/${i.transaction.id}`}>{digits(i.transaction.txn_no)}</Link> : ''),
          },
        ]}
      />
    </>
  )
}
