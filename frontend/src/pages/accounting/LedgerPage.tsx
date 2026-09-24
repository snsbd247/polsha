import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { App, Button, Card, DatePicker, Empty, Select, Space, Table, Typography } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { VOUCHER_TYPE_LABEL, accountFilter, accountLabel, money, moneyOrBlank, useAccountOptions, type LedgerReport, type LedgerRow } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { downloadExport } from '../../lib/phase2'

export default function LedgerPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const [search, setSearch] = useSearchParams()
  const { data: accounts } = useAccountOptions()

  const accountId = Number(search.get('account_id')) || undefined
  const from = search.get('from') ?? dayjs().startOf('month').format('YYYY-MM-DD')
  const to = search.get('to') ?? dayjs().format('YYYY-MM-DD')
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search)
    Object.entries({ from, to, ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setSearch(next, { replace: true })
  }

  // Cashiers and bank users only see their own funds; accountants see every account.
  const options = (accounts ?? []).filter((a) => can('accounting.view') || (a.is_cash ? can('cash.view') : a.is_fund && can('bank.view')))

  const { data, isFetching } = useQuery({
    queryKey: ['ledger', accountId, from, to],
    enabled: !!accountId,
    queryFn: async () => (await api.get<LedgerReport>('/accounting/ledger', { params: { account_id: accountId, from, to } })).data,
  })

  const isCash = accounts?.find((a) => a.id === accountId)?.is_fund
  const voucherLink = (r: LedgerRow) => (can('accounting.view') ? <Link to={`/accounting/journals/${r.journal_id}`}>{digits(r.voucher_no)}</Link> : digits(r.voucher_no))

  return (
    <>
      <div className="page-header">
        <h2>{isCash ? tx('ক্যাশ বই') : tx('খতিয়ান (লেজার)')}</h2>
        <Space wrap className="no-print">
          <Button icon={<PrinterOutlined />} disabled={!data} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {can(['accounting.export', 'cash.export', 'bank.export']) && (
            <Button
              icon={<DownloadOutlined />}
              disabled={!data}
              onClick={() => downloadExport('/accounting/ledger', { account_id: accountId, from, to, export: 'csv' }, `ledger-${data?.account.code}.csv`).catch((e) => message.error(errorMessage(e)))}
            >
              Excel
            </Button>
          )}
        </Space>
      </div>
      <div className="toolbar no-print">
        <Select
          placeholder={tx('হিসাব নির্বাচন করুন')}
          style={{ width: 320 }}
          value={accountId}
          showSearch={{ filterOption: accountFilter }}
          options={options.map((a) => ({ value: a.id, label: accountLabel(a) }))}
          onChange={(v) => set({ account_id: String(v) })}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          allowClear={false}
          value={[dayjs(from), dayjs(to)]}
          onChange={(r) => r?.[0] && r?.[1] && set({ from: r[0].format('YYYY-MM-DD'), to: r[1].format('YYYY-MM-DD') })}
        />
      </div>
      {!accountId ? (
        <Card>
          <Empty description={tx('হিসাব নির্বাচন করুন')} />
        </Card>
      ) : (
        <>
          {data && (
            <Typography.Paragraph>
              <b>{accountLabel(data.account)}</b> · {fmtDate(data.from)} — {fmtDate(data.to)}
            </Typography.Paragraph>
          )}
          <Table<LedgerRow>
            rowKey="line_id"
            size="small"
            loading={isFetching}
            dataSource={data?.rows}
            pagination={false}
            scroll={{ x: 900 }}
            columns={[
              { title: tx('তারিখ'), dataIndex: 'date', width: 105, render: fmtDate },
              { title: tx('ভাউচার নং'), width: 140, render: (_, r) => voucherLink(r) },
              {
                title: tx('বিবরণ'),
                render: (_, r) => (
                  <>
                    {r.narration || VOUCHER_TYPE_LABEL[r.voucher_type]}
                    {r.against.length > 0 && (
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {r.against.map((a) => nameOf(a)).join(', ')}
                      </Typography.Text>
                    )}
                    {r.remarks && (
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {r.remarks}
                      </Typography.Text>
                    )}
                  </>
                ),
              },
              { title: isCash ? tx('জমা') : tx('ডেবিট'), dataIndex: 'debit', width: 130, align: 'right', render: moneyOrBlank },
              { title: isCash ? tx('খরচ') : tx('ক্রেডিট'), dataIndex: 'credit', width: 130, align: 'right', render: moneyOrBlank },
              { title: tx('জের'), dataIndex: 'balance', width: 140, align: 'right', render: money },
            ]}
            summary={() =>
              data ? (
                <>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>
                      <b>{tx('মোট')}</b> ({tx('প্রারম্ভিক জের')}: {money(data.opening)})
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <b>{money(data.total_debit)}</b>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <b>{money(data.total_credit)}</b>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <b>{money(data.closing)}</b>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </>
              ) : null
            }
            title={() => (data ? <span>{tx('প্রারম্ভিক জের')}: <b>{money(data.opening)}</b></span> : null)}
          />
        </>
      )}
    </>
  )
}
