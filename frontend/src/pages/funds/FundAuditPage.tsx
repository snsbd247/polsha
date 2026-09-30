import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Table, Tag } from 'antd'
import { BankFilled, BookFilled, ReloadOutlined, SwapOutlined, WarningFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { api } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { AUDIT_TITLE, type FundKind } from '../../lib/funds'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import '../accounting/accounting.css'

type Issue = { kind: string; account_id?: number; transaction_id?: number; ref: string; name: string | null; expected: number; actual: number | null }
type Resp = {
  book_balance: number
  ledger_balance: number
  difference: number
  accounts: number
  account: { id: number; code: string; name_bn: string; name_en: string | null }
  issues: Issue[]
  kinds: Record<string, string>
}

/** Savings audit / share capital reconciliation: members' account balances against the ledger control account. */
export default function FundAuditPage({ kind }: { kind: FundKind }) {
  const { data, isFetching, refetch } = useQuery({ queryKey: ['fund-audit', kind], queryFn: async () => (await api.get<Resp>(`/funds/${kind}/audit`)).data })
  const ok = data && data.difference === 0 && data.issues.length === 0
  const amt = (v?: number) => (data ? `৳ ${money(v ?? 0)}` : undefined)

  const cards = [
    { key: 'book', label: tx('সদস্য হিসাবের মোট জের · {{p0}}টি হিসাব', { p0: digits(data?.accounts ?? 0) }), value: amt(data?.book_balance), icon: '', glyph: <BankFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'ledger', label: data ? tx('লেজারে জের ({{p0}})', { p0: accountLabel(data.account) }) : tx('লেজারে জের'), value: amt(data?.ledger_balance), icon: '', glyph: <BookFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'diff', label: tx('পার্থক্য'), value: amt(data?.difference), icon: '', glyph: <SwapOutlined />, color: data?.difference ? '#e5383b' : '#1f9d55', tint: data?.difference ? '#fde4e5' : '#dcf3e5' },
    { key: 'issues', label: tx('অমিল'), value: data?.issues.length, icon: '', glyph: <WarningFilled />, color: data?.issues.length ? '#f08c00' : '#1f9d55', tint: data?.issues.length ? '#fdefd6' : '#dcf3e5' },
  ]

  return (
    <PageFrame
      className="ml pl id-page"
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: AUDIT_TITLE[kind] }]}
      title={AUDIT_TITLE[kind]}
      actions={
        <Button type="primary" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          {tx('আবার যাচাই')}
        </Button>
      }
    >
      <StatRow cards={cards} className="li-cards" />
      {data && (
        <Alert
          className="id-alert"
          type={ok ? 'success' : 'error'}
          showIcon
          title={ok ? tx('{{p0}}টি হিসাবের জের, লেনদেন ও লেজার সম্পূর্ণ মিলে গেছে।', { p0: digits(data.accounts) }) : tx('অমিল পাওয়া গেছে — নিচের তালিকা দেখে ঠিক করুন।')}
        />
      )}
      <Box icon={<WarningFilled />} title={tx('অমিলের তালিকা')} className="li-box">
        <Table<Issue>
          rowKey={(r) => `${r.kind}-${r.account_id ?? r.transaction_id}`}
          size="small"
          className="id-payments"
          loading={isFetching}
          dataSource={data?.issues}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('কোনো অমিল নেই') }}
          columns={[
            { title: tx('সমস্যা'), dataIndex: 'kind', render: (k: string) => <Tag className="fl-tag fl-tag-red">{data?.kinds[k] ?? k}</Tag> },
            {
              title: tx('রেফারেন্স'),
              dataIndex: 'ref',
              render: (v: string, r) => (r.account_id ? <Link to={`/funds/${kind}/accounts/${r.account_id}`}>{digits(v)}</Link> : <Link to={`/funds/${kind}/transactions/${r.transaction_id}`}>{digits(v)}</Link>),
            },
            { title: tx('বিবরণ'), dataIndex: 'name', render: (v) => (v ? digits(v) : '—') },
            { title: tx('প্রত্যাশিত (৳)'), dataIndex: 'expected', align: 'right', render: money },
            { title: tx('প্রকৃত (৳)'), dataIndex: 'actual', align: 'right', render: (v) => (v === null ? '—' : money(v)) },
          ]}
        />
      </Box>
    </PageFrame>
  )
}
