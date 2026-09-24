import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Col, DatePicker, Input, InputNumber, Row, Segmented, Statistic, Table, Tag } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { BUCKET_COLOR, useLoanMeta, type LoanRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Row_ = {
  id: number
  loan_no: string
  member: LoanRow['member']
  product: LoanRow['product']
  amount: string
  principal_outstanding: number
  overdue_amount: number
  penalty_due: number
  due_now: number
  days_overdue: number
  oldest_overdue: string | null
  bucket: string | null
  next_due: { date: string; amount: number } | null
  overdue_installments: number
}
type Sum = { loans: number; overdue: number; penalty: number; principal: number }
type Resp = { as_of: string; rows: Row_[]; summary: Record<string, Sum>; total: { loans: number; overdue: number; penalty: number; due_now: number } }
type Params = { as_of: string; bucket?: string; upcoming?: number; search?: string }

/** Loan due list with overdue aging (1–30 / 31–90 / 90+ days). */
export default function LoanDuesPage() {
  const { message } = App.useApp()
  const meta = useLoanMeta()
  const [params, setParams] = useState<Params>({ as_of: dayjs().format('YYYY-MM-DD') })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }))

  const { data, isFetching } = useQuery({
    queryKey: ['loan-dues', params],
    queryFn: async () => (await api.get<Resp>('/loans/dues', { params })).data,
    placeholderData: keepPreviousData,
  })
  const buckets = Object.entries(meta.data?.buckets ?? {})

  return (
    <>
      <div className="page-header">
        <h2>{tx('ঋণের বকেয়া ও Aging')}</h2>
        <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/loans/dues', { ...params, export: 'csv' }, `loan-dues-${params.as_of}.csv`).catch((e) => message.error(errorMessage(e)))}>
          Excel
        </Button>
      </div>
      <div className="toolbar">
        <DatePicker format="DD/MM/YYYY" allowClear={false} value={dayjs(params.as_of)} onChange={(d) => d && set({ as_of: d.format('YYYY-MM-DD') })} />
        <Segmented
          value={params.bucket ?? ''}
          onChange={(v) => set({ bucket: (v as string) || undefined })}
          options={[{ value: '', label: tx('সব') }, ...buckets.map(([value, label]) => ({ value, label }))]}
        />
        <InputNumber
          min={0}
          max={90}
          style={{ width: 200 }}
          placeholder={tx('আগামী কত দিনের কিস্তি')}
          suffix={tx('দিন')}
          onChange={(v) => set({ upcoming: v ?? undefined })}
        />
        <Input.Search placeholder={tx('ঋণ নং, নাম, সদস্য নং বা মোবাইল')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search: search || undefined })} />
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {buckets.map(([k, label]) => {
          const s = data?.summary[k]
          return (
            <Col key={k} xs={24} md={6}>
              <Card size="small" hoverable onClick={() => set({ bucket: params.bucket === k ? undefined : k })} style={params.bucket === k ? { borderColor: '#1677ff' } : undefined}>
                <Statistic title={<Tag color={BUCKET_COLOR[k]}>{label}</Tag>} value={money(s?.overdue)} prefix="৳" />
                <div style={{ color: '#666', fontSize: 12 }}>
                  {tx('{{p0}}টি ঋণ · আসল বাকি ৳{{p1}} · জরিমানা ৳{{p2}}', { p0: digits(s?.loans ?? 0), p1: money(s?.principal), p2: money(s?.penalty) })}
                </div>
              </Card>
            </Col>
          )
        })}
        <Col xs={24} md={6}>
          <Card size="small">
            <Statistic title={tx('মোট এখন দেয়')} value={money(data?.total.due_now)} prefix="৳" />
            <div style={{ color: '#666', fontSize: 12 }}>
              {tx('{{p0}}টি ঋণ · মেয়াদোত্তীর্ণ ৳{{p1}}', { p0: digits(data?.total.loans ?? 0), p1: money(data?.total.overdue) })}
            </div>
          </Card>
        </Col>
      </Row>

      <Table<Row_>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.rows}
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: tx('কোনো বকেয়া নেই') }}
        columns={[
          { title: tx('ঋণ নং'), dataIndex: 'loan_no', width: 140, render: (v: string, r) => <Link to={`/loans/${r.id}`}>{digits(v)}</Link> },
          {
            title: tx('সদস্য'),
            render: (_, r) => (
              <>
                {nameOf(r.member?.farmer)} <span style={{ color: '#888' }}>({digits(r.member?.member_no)})</span>
                {r.member?.farmer?.mobile && <div style={{ color: '#888', fontSize: 12 }}>{digits(r.member.farmer.mobile)}</div>}
              </>
            ),
          },
          { title: tx('ঋণের ধরন'), render: (_, r) => nameOf(r.product) },
          { title: tx('আসল বাকি'), dataIndex: 'principal_outstanding', align: 'right', render: money },
          { title: tx('মেয়াদোত্তীর্ণ'), dataIndex: 'overdue_amount', align: 'right', render: (v: number, r) => (v ? `${money(v)} (${digits(r.overdue_installments)})` : '') },
          { title: tx('জরিমানা'), dataIndex: 'penalty_due', align: 'right', render: (v: number) => (v ? money(v) : '') },
          { title: tx('এখন দেয়'), dataIndex: 'due_now', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
          {
            title: tx('দিন'),
            dataIndex: 'days_overdue',
            width: 130,
            render: (d: number, r) => (r.bucket ? <Tag color={BUCKET_COLOR[r.bucket]}>{tx('{{p0}} দিন', { p0: digits(d) })}</Tag> : ''),
          },
          { title: tx('পরবর্তী কিস্তি'), width: 170, render: (_, r) => (r.next_due ? `${fmtDate(r.next_due.date)} — ৳${money(r.next_due.amount)}` : '') },
        ]}
      />
    </>
  )
}
