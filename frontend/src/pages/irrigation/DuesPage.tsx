import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Checkbox, Col, Input, Row, Select, Space, Statistic, Table } from 'antd'
import { DollarOutlined, DownloadOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useInvoiceMeta } from '../../lib/irrigation'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Row = {
  farmer_id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mobile: string | null
  invoice_count: number
  amount: number
  paid: number
  due: number
  oldest: string
}
type Resp = { data: Row[]; total: number; totals: { farmers: number; amount: number; paid: number; due: number } }
type Params = { page: number; per_page: number; search?: string; season_id?: number; mouza_id?: number; overdue?: string }

export default function DuesPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: meta } = useInvoiceMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-dues', params],
    queryFn: async () => (await api.get<Resp>('/irrigation/dues', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচ বকেয়া তালিকা') }]}
      title={tx('সেচ বকেয়া তালিকা')}
      actions={
        <span className="id-actions no-print">
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/irrigation/dues', { ...params, page: undefined, export: 'csv' }, 'irrigation-dues.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
        </span>
      }
    >
      <div className="toolbar">
        <Input.Search placeholder={tx('নাম বা কৃষক আইডি')} allowClear style={{ width: 220 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('মৌসুম')} allowClear style={{ width: 170 }} options={meta?.seasons.map((s) => ({ value: s.id, label: s.name_bn }))} onChange={(season_id) => set({ season_id })} />
        <Select placeholder={tx('মৌজা')} allowClear style={{ width: 170 }} showSearch={{ optionFilterProp: 'label' }} options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))} onChange={(mouza_id) => set({ mouza_id })} />
        <Checkbox onChange={(e) => set({ overdue: e.target.checked ? '1' : undefined })}>{tx('শুধু মেয়াদোত্তীর্ণ')}</Checkbox>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বকেয়াদার চাষি')} value={digits(data?.totals.farmers ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('মোট বিল')} value={money(data?.totals.amount)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('আদায়')} value={money(data?.totals.paid)} prefix="৳" styles={{ content: { color: '#389e0d' } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বকেয়া')} value={money(data?.totals.due)} prefix="৳" styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
      </Row>
      <Table<Row>
        rowKey="farmer_id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}} জন', { p0: digits(t) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('কৃষক আইডি'), dataIndex: 'farmer_code', width: 120, render: (v: string) => digits(v) },
          { title: tx('নাম'), render: (_, r) => <Link to={`/irrigation/farmers/${r.farmer_id}/statement`}>{nameOf(r)}</Link> },
          { title: tx('পিতার নাম'), dataIndex: 'father_name' },
          { title: tx('মোবাইল'), dataIndex: 'mobile', width: 130, render: (v) => (v ? digits(v) : '') },
          { title: tx('ইনভয়েস'), dataIndex: 'invoice_count', width: 90, align: 'right', render: (v: number) => digits(v) },
          { title: tx('মোট বিল'), dataIndex: 'amount', width: 120, align: 'right', render: money },
          { title: tx('আদায়'), dataIndex: 'paid', width: 120, align: 'right', render: money },
          { title: tx('বকেয়া'), dataIndex: 'due', width: 120, align: 'right', render: (v: number) => <strong style={{ color: '#cf1322' }}>{money(v)}</strong> },
          { title: tx('সবচেয়ে পুরনো'), dataIndex: 'oldest', width: 115, render: fmtDate },
          {
            title: '',
            width: 110,
            render: (_, r) => (
              <Space>
                {can('payment.create') && (
                  <Button size="small" icon={<DollarOutlined />} onClick={() => navigate(`/payments/collect?farmer_id=${r.farmer_id}`)}>
                    {tx('আদায়')}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
    </PageFrame>
  )
}
