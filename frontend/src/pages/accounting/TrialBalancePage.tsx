import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Space, Table } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { ACCOUNT_TYPE_LABEL, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { downloadExport } from '../../lib/phase2'
import PageFrame from '../../components/PageFrame'

type Row = { id: number; code: string; name_bn: string; name_en: string | null; type: string; debit: number; credit: number }
type Report = { as_of: string; rows: Row[]; total_debit: number; total_credit: number; balanced: boolean }

export default function TrialBalancePage() {
  const { message } = App.useApp()
  const [asOf, setAsOf] = useState<Dayjs>(dayjs())
  const ymd = asOf.format('YYYY-MM-DD')

  const { data, isFetching } = useQuery({
    queryKey: ['trial-balance', ymd],
    queryFn: async () => (await api.get<Report>('/accounting/trial-balance', { params: { as_of: ymd } })).data,
  })

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('হিসাব'), to: '/accounting/summary' }, { label: tx('হিসাবের তালিকা'), to: '/accounting/accounts' }, { label: tx('রেওয়ামিল (Trial Balance)') }]}
      title={tx('রেওয়ামিল (Trial Balance)')}
      actions={
        <span className="id-actions no-print">
          <Space wrap className="no-print">
            <DatePicker value={asOf} format="DD/MM/YYYY" allowClear={false} onChange={(d) => d && setAsOf(d)} />
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              {tx('প্রিন্ট')}
            </Button>
            <Can perm="accounting.export">
              <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/accounting/trial-balance', { as_of: ymd, export: 'csv' }, `trial-balance-${ymd}.csv`).catch((e) => message.error(errorMessage(e)))}>
                Excel
              </Button>
            </Can>
          </Space>
        </span>
      }
    >
      {data && (
        <Alert
          type={data.balanced ? 'success' : 'error'}
          showIcon
          style={{ marginBottom: 16 }}
          title={data.balanced ? tx('{{p0}} তারিখে ডেবিট ও ক্রেডিট মিলেছে।', { p0: fmtDate(data.as_of) }) : tx('ডেবিট ও ক্রেডিট মেলেনি! হিসাব পরীক্ষা করুন।')}
        />
      )}
      <Table<Row>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: tx('কোড'), dataIndex: 'code', width: 90, render: digits },
          { title: tx('হিসাব'), render: (_, r) => <Link to={`/accounting/ledger?account_id=${r.id}&from=${dayjs(ymd).startOf('year').format('YYYY-MM-DD')}&to=${ymd}`}>{nameOf(r)}</Link> },
          { title: tx('ধরন'), dataIndex: 'type', width: 130, render: (t: string) => ACCOUNT_TYPE_LABEL[t] ?? t },
          { title: tx('ডেবিট'), dataIndex: 'debit', width: 150, align: 'right', render: moneyOrBlank },
          { title: tx('ক্রেডিট'), dataIndex: 'credit', width: 150, align: 'right', render: moneyOrBlank },
        ]}
        summary={() =>
          data ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3} align="right">
                <b>{tx('মোট')}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <b>{money(data.total_debit)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <b>{money(data.total_credit)}</b>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }
      />
    </PageFrame>
  )
}
