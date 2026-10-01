import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Space, Statistic, Table, Tag } from 'antd'
import { CalculatorOutlined, SendOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { round2 } from '../../lib/irrigation'
import type { FarmerBrief } from '../../lib/funds'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type PreviewRow = { member_id: number; member_no: number | string | null; member_status: string | null; farmer: FarmerBrief | null; account_no?: string; basis: number; amount: number }
type Preview = { rows: PreviewRow[]; total_basis: number; total?: number }

/**
 * profit: the manager types each member's profit (a % helper fills them in).
 * dividend: a pool split pro-rata on share balances as of the basis date;
 * the server recomputes the split when saving.
 */
export default function DistributionFormPage() {
  const { kind = 'profit' } = useParams()
  return <DistributionForm key={kind} kind={kind} />
}

function DistributionForm({ kind }: { kind: string }) {
  const profit = kind === 'profit'
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [amounts, setAmounts] = useState<Record<number, number>>({})
  const [rate, setRate] = useState<number | null>(null)
  const [dividend, setDividend] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const profitRows = useQuery({
    queryKey: ['distribution-preview', 'profit'],
    queryFn: async () => (await api.get<Preview>('/distributions/profit/preview')).data,
    enabled: profit,
  })
  const rows = profit ? (profitRows.data?.rows ?? []) : (dividend?.rows ?? [])
  const total = profit ? round2(Object.values(amounts).reduce((s, v) => s + (v || 0), 0)) : (dividend?.total ?? 0)
  const totalBasis = profit ? profitRows.data?.total_basis : dividend?.total_basis

  const applyRate = () => {
    if (rate === null) return
    setAmounts(Object.fromEntries(rows.map((r) => [r.member_id, round2((r.basis * rate) / 100)])))
  }

  const previewDividend = async () => {
    const v = await form.validateFields(['basis_date', 'pool_amount'])
    setLoading(true)
    try {
      const res = await api.get<Preview>('/distributions/dividend/preview', { params: { basis_date: (v.basis_date as Dayjs).format('YYYY-MM-DD'), pool_amount: v.pool_amount } })
      setDividend(res.data)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    const v = await form.validateFields()
    if (!profit && !dividend) return message.warning(tx('আগে হিসাব করে দেখুন।'))
    setSaving(true)
    try {
      const res = await api.post<{ id: number; message: string }>(`/distributions/${kind}`, {
        title: v.title,
        remarks: v.remarks,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        ...(profit
          ? {
              items: Object.entries(amounts)
                .filter(([, a]) => a > 0)
                .map(([member_id, amount]) => ({ member_id: Number(member_id), amount })),
            }
          : { basis_date: (v.basis_date as Dayjs).format('YYYY-MM-DD'), pool_amount: v.pool_amount }),
      })
      message.success(res.data.message)
      navigate(`/funds/distributions/${res.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('সঞ্চয়'), to: '/savings/accounts' }, { label: tx('মুনাফা ও লভ্যাংশ বণ্টন'), to: '/funds/distributions' }, { label: profit ? tx('নতুন সঞ্চয়ের মুনাফা বণ্টন') : tx('নতুন শেয়ারের লভ্যাংশ বণ্টন') }]}
      title={profit ? tx('নতুন সঞ্চয়ের মুনাফা বণ্টন') : tx('নতুন শেয়ারের লভ্যাংশ বণ্টন')}
      actions={
        <span className="id-actions no-print">
          <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={save} disabled={total <= 0}>
            {tx('অনুমোদনে পাঠান')}
          </Button>
        </span>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={
          profit
            ? tx('প্রতিটি সদস্যের মুনাফা নিজে লিখুন (বা % দিয়ে একসাথে বসিয়ে প্রয়োজনমতো বদলান)। অনুমোদনের পর টাকা সদস্যের সঞ্চয় হিসাবে জমা হবে।')
            : tx('ভিত্তি তারিখে সদস্যের শেয়ার জের অনুযায়ী মোট লভ্যাংশ আনুপাতিক হারে ভাগ হবে। অনুমোদনের পর লভ্যাংশ সদস্যের সঞ্চয় হিসাবে জমা হবে (না থাকলে খোলা হবে)।')
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ date: dayjs(), basis_date: dayjs() }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="title" label={tx('শিরোনাম')} rules={[required(tx('শিরোনাম লিখুন'))]}>
                <Input maxLength={200} placeholder={profit ? tx('যেমন: ২০২৬ সালের সঞ্চয়ের মুনাফা') : tx('যেমন: ২০২৬ সালের লভ্যাংশ')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="date" label={tx('বণ্টনের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            {!profit && (
              <>
                <Col xs={12} md={6}>
                  <Form.Item name="basis_date" label={tx('ভিত্তি তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} onChange={() => setDividend(null)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="pool_amount" label={tx('মোট লভ্যাংশ')} rules={[required(tx('টাকার পরিমাণ দিন'))]}>
                    <InputNumber min={0.01} precision={2} prefix="৳" style={{ width: '100%' }} onChange={() => setDividend(null)} />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24} md={12}>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
          {profit ? (
            <Space wrap>
              <InputNumber min={0} max={100} precision={2} suffix="%" value={rate} onChange={setRate} placeholder={tx('হার')} style={{ width: 140 }} />
              <Button icon={<CalculatorOutlined />} onClick={applyRate} disabled={rate === null}>
                {tx('জের অনুযায়ী বসান')}
              </Button>
              <Button onClick={() => setAmounts({})}>{tx('সব মুছুন')}</Button>
            </Space>
          ) : (
            <Button icon={<CalculatorOutlined />} loading={loading} onClick={previewDividend}>
              {tx('হিসাব করে দেখুন')}
            </Button>
          )}
        </Form>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={tx('সদস্য সংখ্যা')} value={digits(profit ? Object.values(amounts).filter((a) => a > 0).length : rows.length)} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title={profit ? tx('মোট সঞ্চয় জের') : tx('মোট শেয়ার জের')} value={money(totalBasis)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Statistic title={tx('মোট বণ্টন')} value={money(total)} prefix="৳" />
          </Card>
        </Col>
      </Row>

      <Table<PreviewRow>
        rowKey="member_id"
        size="small"
        loading={profit ? profitRows.isFetching : loading}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 500] }}
        columns={[
          { title: tx('সদস্য নং'), dataIndex: 'member_no', width: 90, render: (v) => digits(v) },
          ...(profit ? [{ title: tx('হিসাব নং'), dataIndex: 'account_no', width: 130, render: (v: string) => digits(v) }] : []),
          {
            title: tx('নাম'),
            render: (_, r) => (
              <>
                {nameOf(r.farmer)}
                {r.member_status && r.member_status !== 'active' && (
                  <Tag color="orange" style={{ marginLeft: 6 }}>
                    {tx('সক্রিয় নয়')}
                  </Tag>
                )}
              </>
            ),
          },
          { title: profit ? tx('সঞ্চয় জের') : tx('শেয়ার জের'), dataIndex: 'basis', width: 140, align: 'right', render: money },
          {
            title: profit ? tx('মুনাফা') : tx('লভ্যাংশ'),
            width: 170,
            align: 'right',
            render: (_, r) =>
              profit ? <InputNumber min={0} precision={2} size="small" style={{ width: 140 }} value={amounts[r.member_id] ?? null} onChange={(v) => setAmounts((a) => ({ ...a, [r.member_id]: v ?? 0 }))} /> : money(r.amount),
          },
        ]}
      />
    </PageFrame>
  )
}
