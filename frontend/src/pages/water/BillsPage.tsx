import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { App, Button, Card, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd'
import { CloseCircleOutlined, DollarOutlined, DownloadOutlined, GiftOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { BILL_STATUS_COLOR, billLabel, monthLabel, useWaterMeta, type WaterBill } from '../../lib/water'
import PageFrame from '../../components/PageFrame'

type Totals = { count: number; amount: number; penalty: number; paid: number; due: number }
type Params = { page: number; per_page: number; period?: string; status?: string; kind?: string; type_id?: number; village_id?: number; search?: string }

export default function BillsPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25, period: search.get('period') ?? undefined })
  const [cancelling, setCancelling] = useState<WaterBill | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ reason: string }>()
  const [waiving, setWaiving] = useState<WaterBill | null>(null)
  const [waiveForm] = Form.useForm<{ reason: string }>()
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'bills', params],
    queryFn: async () => (await api.get<Paginated<WaterBill> & { totals: Totals }>('/water/bills', { params })).data,
    placeholderData: keepPreviousData,
  })

  const requestCancel = async ({ reason }: { reason: string }) => {
    if (!cancelling) return
    setBusy(true)
    try {
      await api.post(`/water/bills/${cancelling.id}/cancel`, { reason })
      message.success(tx('বাতিলের অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(null)
      queryClient.invalidateQueries({ queryKey: ['water'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const waive = async ({ reason }: { reason: string }) => {
    if (!waiving) return
    setBusy(true)
    try {
      await api.post(`/water/bills/${waiving.id}/waive-penalty`, { reason })
      message.success(tx('জরিমানা মওকুফ হয়েছে।'))
      setWaiving(null)
      queryClient.invalidateQueries({ queryKey: ['water'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const t = data?.totals
  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির বিল') }]}
      title={tx('পানির বিল')}
      actions={
        <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/water/bills', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'water-bills.csv').catch((e) => message.error(errorMessage(e)))}>
          Excel
        </Button>
      }
    >
      <div className="toolbar">
        <Input.Search placeholder={tx('বিল নং, নাম, মোবাইল বা সংযোগ নং')} allowClear style={{ width: 260 }} onSearch={(s) => set({ search: s })} />
        <DatePicker
          picker="month"
          placeholder={tx('মাস')}
          value={params.period ? dayjs(`${params.period}-01`) : null}
          format={(d) => monthLabel(d.format('YYYY-MM'))}
          onChange={(d) => set({ period: d ? d.format('YYYY-MM') : undefined })}
        />
        <Select
          placeholder={tx('অবস্থা')}
          allowClear
          style={{ width: 160 }}
          options={[{ value: 'open', label: tx('বকেয়া (অপরিশোধিত + আংশিক)') }, ...Object.entries(meta?.bill_statuses ?? {}).map(([value, label]) => ({ value, label }))]}
          onChange={(status) => set({ status })}
        />
        <Select placeholder={tx('কিসের বিল')} allowClear style={{ width: 140 }} options={Object.entries(meta?.kinds ?? {}).map(([value, label]) => ({ value, label }))} onChange={(kind) => set({ kind })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 140 }} options={meta?.types.map((x) => ({ value: x.id, label: nameOf(x) }))} onChange={(type_id) => set({ type_id })} />
        <Select placeholder={tx('গ্রাম')} allowClear style={{ width: 160 }} showSearch={{ optionFilterProp: 'label' }} options={villages.data?.map((v) => ({ value: v.id, label: nameOf(v) }))} onChange={(village_id) => set({ village_id })} />
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বিল')} value={digits(t?.count ?? 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বিলের টাকা (জরিমানাসহ)')} value={money((t?.amount ?? 0) + (t?.penalty ?? 0))} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('আদায়')} value={money(t?.paid)} prefix="৳" styles={{ content: { color: '#389e0d' } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বকেয়া')} value={money(t?.due)} prefix="৳" styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
      </Row>
      <Table<WaterBill>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1150 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (n) => tx('মোট {{p0}}টি', { p0: digits(n) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('বিল নং'), dataIndex: 'bill_no', width: 150, render: (v: string) => digits(v) },
          { title: tx('কিসের বিল'), width: 140, render: (_, b) => billLabel(b) },
          { title: tx('সংযোগ নং'), width: 115, render: (_, b) => <Link to={`/water/connections/${b.connection_id}`}>{digits(b.snapshot.connection_no)}</Link> },
          { title: tx('গ্রাহক'), render: (_, b) => nameOf(b.snapshot) },
          { title: tx('বিলের তারিখ'), dataIndex: 'bill_date', width: 110, render: fmtDate },
          { title: tx('বিল'), dataIndex: 'amount', width: 95, align: 'right', render: money },
          { title: tx('জরিমানা'), dataIndex: 'penalty', width: 90, align: 'right', render: (v: number) => (v ? money(v) : '') },
          { title: tx('আদায়'), dataIndex: 'paid_amount', width: 95, align: 'right', render: money },
          { title: tx('বকেয়া'), dataIndex: 'due', width: 95, align: 'right', render: (v: number) => (v > 0 ? <strong style={{ color: '#cf1322' }}>{money(v)}</strong> : money(0)) },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 115, render: (s: string) => <Tag color={BILL_STATUS_COLOR[s]}>{meta?.bill_statuses[s] ?? s}</Tag> },
          {
            title: '',
            width: 120,
            render: (_, b) => (
              <Space size={4}>
                {can('water.create') && b.due > 0 && (
                  <Button size="small" icon={<DollarOutlined />} onClick={() => navigate(`/water/collect?connection=${b.connection_id}`)} aria-label={tx('আদায়')} />
                )}
                {can('water.edit') && b.status === 'unpaid' && b.paid_amount === 0 && (
                  <Button
                    size="small"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => {
                      form.resetFields()
                      setCancelling(b)
                    }}
                    aria-label={tx('বাতিল')}
                  />
                )}
                {can('water.approve') && b.penalty > 0 && b.due > 0 && (
                  <Button
                    size="small"
                    icon={<GiftOutlined />}
                    title={tx('জরিমানা মওকুফ')}
                    onClick={() => {
                      waiveForm.resetFields()
                      setWaiving(b)
                    }}
                    aria-label={tx('জরিমানা মওকুফ')}
                  />
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!cancelling}
        title={tx('বিল বাতিলের অনুরোধ — {{p0}}', { p0: digits(cancelling?.bill_no ?? '') })}
        onCancel={() => setCancelling(null)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText={tx('অনুমোদনের জন্য পাঠান')}
        destroyOnHidden
      >
        <p style={{ color: '#888' }}>{tx('ম্যানেজার অনুমোদন দিলে বিল বাতিল হবে ও হিসাবের খাতায় উল্টো এন্ট্রি হবে।')}</p>
        <Form form={form} layout="vertical" onFinish={requestCancel}>
          <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!waiving}
        title={tx('জরিমানা মওকুফ — {{p0}}', { p0: digits(waiving?.bill_no ?? '') })}
        onCancel={() => setWaiving(null)}
        onOk={() => waiveForm.submit()}
        confirmLoading={busy}
        okText={tx('মওকুফ করুন')}
        destroyOnHidden
      >
        <p style={{ color: '#888' }}>
          {tx('এই বিলে অপরিশোধিত জরিমানা ৳{{p0}} মওকুফ হবে; আগে আদায় হওয়া টাকা বদলাবে না।', { p0: money(Math.min(waiving?.penalty ?? 0, waiving?.due ?? 0)) })}
        </p>
        <Form form={waiveForm} layout="vertical" onFinish={waive}>
          <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
