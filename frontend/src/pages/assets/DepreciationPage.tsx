import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Popconfirm, Table, Tabs } from 'antd'
import { CalculatorOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'

type PreviewRow = {
  asset: { id: number; asset_code: string; name_bn: string; name_en: string | null; cost: string; accumulated_depreciation: string; book_value: number; category: { name_bn: string; name_en: string | null } | null }
  amount: number
}
type Preview = { period: string; rows: PreviewRow[]; total: number; posted: number }
type Run = { period: string; journal_id: number; assets: number; amount: string; journal: { id: number; voucher_no: string; date: string } | null }
type RunResult = Record<string, { count: number; total: number; voucher: string | null; skipped?: boolean }>

/** Straight-line monthly depreciation: preview, run (catches up missed months) and history. */
export default function DepreciationPage() {
  const { message, modal } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<Dayjs>(dayjs().startOf('month'))
  const [page, setPage] = useState(1)
  const key = period.format('YYYY-MM')
  const preview = useQuery({ queryKey: ['depreciation-preview', key], queryFn: async () => (await api.get<Preview>('/assets/depreciation/preview', { params: { period: key } })).data })
  const history = useQuery({
    queryKey: ['depreciation-history', page],
    queryFn: async () => (await api.get<Paginated<Run>>('/assets/depreciation', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })

  const run = async () => {
    try {
      const r = await api.post<{ runs: RunResult }>('/assets/depreciation', { period: key })
      const months = Object.entries(r.data.runs)
      if (!months.length) message.info(tx('চালানোর মতো কোনো অবচয় নেই।'))
      else
        modal.success({
          title: tx('অবচয় পোস্ট হয়েছে'),
          content: (
            <ul style={{ paddingLeft: 18 }}>
              {months.map(([m, x]) => (
                <li key={m}>
                  {digits(m)}: {x.skipped ? tx('হিসাব-মাস বন্ধ, বাদ গেছে') : tx('{{p0}} টি সম্পদ, ৳{{p1}} (ভাউচার {{p2}})', { p0: digits(x.count), p1: money(x.total), p2: digits(x.voucher) })}
                </li>
              ))}
            </ul>
          ),
        })
      queryClient.invalidateQueries({ queryKey: ['depreciation-preview'] })
      queryClient.invalidateQueries({ queryKey: ['depreciation-history'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset-dashboard'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('সম্পদের অবচয়')}</h2>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={tx('সরল রেখা পদ্ধতি: মাসিক অবচয় = (ক্রয়মূল্য − অবশিষ্ট মূল্য) ÷ আয়ুষ্কাল (মাস)। কোনো মাস বাদ থাকলে চালানোর সময় আগের মাসগুলোও ক্রমানুসারে পোস্ট হবে।')}
      />
      <Tabs
        items={[
          {
            key: 'run',
            label: tx('মাসিক অবচয়'),
            children: (
              <Card>
                <div className="toolbar">
                  <DatePicker picker="month" value={period} format="MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'month')} onChange={(d) => d && setPeriod(d)} />
                  <Can perm="asset.edit">
                    <Popconfirm title={tx('{{p0}} পর্যন্ত অবচয় পোস্ট করবেন?', { p0: digits(key) })} onConfirm={run} disabled={!preview.data?.rows.length}>
                      <Button type="primary" icon={<CalculatorOutlined />} disabled={!preview.data?.rows.length}>
                        {tx('অবচয় চালান')}
                      </Button>
                    </Popconfirm>
                  </Can>
                  <span>
                    {tx('এই মাসে বাকি: ৳{{p0}} · আগেই পোস্ট: ৳{{p1}}', { p0: money(preview.data?.total ?? 0), p1: money(preview.data?.posted ?? 0) })}
                  </span>
                </div>
                <Table<PreviewRow>
                  rowKey={(r) => r.asset.id}
                  size="small"
                  loading={preview.isFetching}
                  dataSource={preview.data?.rows}
                  pagination={false}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: tx('কোড'), render: (_, r) => <Link to={`/assets/${r.asset.id}`}>{digits(r.asset.asset_code)}</Link> },
                    { title: tx('নাম'), render: (_, r) => nameOf(r.asset) },
                    { title: tx('শ্রেণি'), render: (_, r) => nameOf(r.asset.category) },
                    { title: tx('ক্রয়মূল্য'), align: 'right', render: (_, r) => money(r.asset.cost) },
                    { title: tx('পুঞ্জীভূত অবচয়'), align: 'right', render: (_, r) => money(r.asset.accumulated_depreciation) },
                    { title: tx('বর্তমান মূল্য'), align: 'right', render: (_, r) => money(r.asset.book_value) },
                    { title: tx('এই মাসের অবচয়'), dataIndex: 'amount', align: 'right', render: money },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'history',
            label: tx('পোস্ট করা অবচয়'),
            children: (
              <Table<Run>
                rowKey={(r) => `${r.period}-${r.journal_id}`}
                loading={history.isFetching}
                dataSource={history.data?.data}
                pagination={{ current: page, total: history.data?.total, pageSize: history.data?.per_page, onChange: setPage }}
                columns={[
                  { title: tx('মাস'), dataIndex: 'period', render: (v: string) => digits(v) },
                  { title: tx('সম্পদ সংখ্যা'), dataIndex: 'assets', render: digits },
                  { title: tx('অবচয়'), dataIndex: 'amount', align: 'right', render: money },
                  { title: tx('ভাউচারের তারিখ'), render: (_, r) => fmtDate(r.journal?.date) },
                  {
                    title: tx('ভাউচার'),
                    render: (_, r) => (r.journal ? can('accounting.view') ? <Link to={`/accounting/journals/${r.journal.id}`}>{digits(r.journal.voucher_no)}</Link> : digits(r.journal.voucher_no) : null),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </>
  )
}
