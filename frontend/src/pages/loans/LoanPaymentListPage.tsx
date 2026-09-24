import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Col, DatePicker, Input, Row, Select, Statistic, Table, Tag } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { toOptions } from '../../lib/funds'
import { METHOD_LABEL } from '../../lib/irrigation'
import { PAYMENT_STATUS_COLOR, useLoanMeta, type LoanPayment } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Totals = { amount: number; penalty: number; interest: number; principal: number }
type Resp = Paginated<LoanPayment> & { totals: Totals }
type Params = { page: number; per_page: number; search?: string; status?: string; method?: string; from?: string; to?: string }

/** Every loan repayment receipt, with the penalty / interest / principal totals. */
export default function LoanPaymentListPage() {
  const { message } = App.useApp()
  const meta = useLoanMeta()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['loan-payments', params],
    queryFn: async () => (await api.get<Resp>('/loans/payments', { params })).data,
    placeholderData: keepPreviousData,
  })
  const stats: [keyof Totals, string][] = [
    ['amount', tx('মোট আদায়')],
    ['principal', tx('আসল')],
    ['interest', tx('সুদ')],
    ['penalty', tx('জরিমানা')],
  ]

  return (
    <>
      <div className="page-header">
        <h2>{tx('ঋণ পরিশোধ ও রশিদ')}</h2>
        <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/loans/payments', { ...params, page: undefined, export: 'csv' }, 'loan-payments.csv').catch((e) => message.error(errorMessage(e)))}>
          Excel
        </Button>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('রশিদ নং, ঋণ নং, নাম বা সদস্য নং')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 170 }} options={toOptions(meta.data?.payment_statuses)} onChange={(status) => set({ status })} />
        <Select placeholder={tx('মাধ্যম')} allowClear style={{ width: 150 }} options={toOptions(METHOD_LABEL)} onChange={(method) => set({ method })} />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
      </div>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {stats.map(([k, label]) => (
          <Col key={k} xs={12} md={6}>
            <Card size="small">
              <Statistic title={label} value={money(data?.totals[k])} prefix="৳" />
            </Card>
          </Col>
        ))}
      </Row>
      <Table<LoanPayment>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি', { p0: digits(t) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('রশিদ নং'), dataIndex: 'payment_no', width: 140, render: (v: string, r) => <Link to={`/loans/payments/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          { title: tx('ঋণ নং'), width: 140, render: (_, r) => r.loan && <Link to={`/loans/${r.loan.id}`}>{digits(r.loan.loan_no)}</Link> },
          {
            title: tx('সদস্য'),
            render: (_, r) => (
              <>
                {nameOf(r.loan?.member?.farmer)} <span style={{ color: '#888' }}>({digits(r.loan?.member?.member_no)})</span>
              </>
            ),
          },
          { title: tx('মোট'), dataIndex: 'amount', align: 'right', render: money },
          { title: tx('জরিমানা'), dataIndex: 'penalty', align: 'right', render: money },
          { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
          { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
          { title: tx('মাধ্যম'), dataIndex: 'method', width: 100, render: (m: string) => METHOD_LABEL[m] ?? m },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 150, render: (s: string) => <Tag color={PAYMENT_STATUS_COLOR[s]}>{meta.data?.payment_statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}
