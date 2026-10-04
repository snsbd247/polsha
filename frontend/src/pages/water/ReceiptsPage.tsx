import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { Button, Card, Col, DatePicker, Input, Row, Select, Statistic, Table, Tag } from 'antd'
import { DollarOutlined, PrinterOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Row = { id: number; receipt_no: string; date: string; payer_name: string; amount: string; method: string; status: string; creator: { name_bn: string; name_en: string | null } | null }
type Params = { page: number; per_page: number; search?: string; status?: string; method?: string; from?: string; to?: string }

export default function ReceiptsPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'receipts', params],
    queryFn: async () => (await api.get<Paginated<Row> & { total_amount: number }>('/water/receipts', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির রশিদ') }]}
      title={tx('পানির রশিদ')}
      actions={
        can('water.create') && (
          <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate('/water/collect')}>
            {tx('বিল আদায়')}
          </Button>
        )
      }
    >
      <div className="toolbar">
        <Input.Search placeholder={tx('রশিদ নং বা নাম')} allowClear style={{ width: 220 }} onSearch={(search) => set({ search })} />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 150 }} options={Object.entries(RECEIPT_STATUS_LABEL).map(([value, label]) => ({ value, label }))} onChange={(status) => set({ status })} />
        <Select placeholder={tx('মাধ্যম')} allowClear style={{ width: 150 }} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} onChange={(method) => set({ method })} />
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('রশিদ')} value={digits(data?.total ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('মোট আদায় (বাতিল বাদে)')} value={money(data?.total_amount)} prefix="৳" styles={{ content: { color: '#389e0d' } }} />
          </Card>
        </Col>
      </Row>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('রশিদ নং'), dataIndex: 'receipt_no', width: 150, render: (v: string, r) => <Link to={`/water/receipts/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
          { title: tx('গ্রাহক'), dataIndex: 'payer_name' },
          { title: tx('টাকা'), dataIndex: 'amount', width: 110, align: 'right', render: money },
          { title: tx('মাধ্যম'), dataIndex: 'method', width: 110, render: (m: string) => METHOD_LABEL[m] ?? m },
          { title: tx('আদায়কারী'), width: 150, render: (_, r) => nameOf(r.creator) },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 130, render: (s: string) => <Tag color={RECEIPT_STATUS_COLOR[s]}>{RECEIPT_STATUS_LABEL[s] ?? s}</Tag> },
          { title: '', width: 60, render: (_, r) => <Button size="small" icon={<PrinterOutlined />} onClick={() => navigate(`/water/receipts/${r.id}?print=1`)} aria-label={tx('প্রিন্ট')} /> },
        ]}
      />
    </PageFrame>
  )
}
