import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Radio, Row, Select, Space, Table, Tag, Typography } from 'antd'
import { CheckOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { METHOD_LABEL, round2, type ReceiptFund } from '../../lib/irrigation'
import { COMBINED_MODULES, MODULE_COLOR, type CombinedModule, type CombinedQuote } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

/** One payment at the counter, split over loan instalment, irrigation dues, share and savings. */
export default function CombinedPaymentPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const [form] = Form.useForm()
  const [farmerId, setFarmerId] = useState<number | null>(Number(search.get('farmer_id')) || null)
  const [amount, setAmount] = useState<number | null>(null)
  const [debounced, setDebounced] = useState<number>(0)
  const [manual, setManual] = useState<Partial<Record<CombinedModule, number>> | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = setTimeout(() => setDebounced(amount ?? 0), 300)
    return () => clearTimeout(h)
  }, [amount])

  const date: Dayjs = Form.useWatch('date', form) ?? dayjs()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const quote = useQuery({
    queryKey: ['combined-quote', farmerId, date.format('YYYY-MM-DD'), debounced],
    queryFn: async () => (await api.get<CombinedQuote>('/combined-payments/quote', { params: { farmer_id: farmerId, date: date.format('YYYY-MM-DD'), amount: debounced } })).data,
    enabled: !!farmerId,
    placeholderData: keepPreviousData,
  })
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data })
  const q = quote.data
  const auto = q?.allocation.parts
  const parts: Record<CombinedModule, number> = { loan: 0, irrigation: 0, share: 0, savings: 0, ...(auto ?? {}), ...(manual ?? {}) }
  const partsSum = round2(COMBINED_MODULES.reduce((s, m) => s + (parts[m] || 0), 0))
  const gap = round2((amount ?? 0) - partsSum)
  const limits: Record<CombinedModule, number | undefined> = {
    loan: q?.loan?.payable ? q.loan.payoff : 0,
    irrigation: q?.irrigation.due ?? 0,
    share: q?.member_active ? undefined : 0,
    savings: q?.member_active ? undefined : 0,
  }
  const totalDue = q ? round2((q.loan?.payable ? q.loan.due_now : 0) + q.irrigation.due + q.share.due) : 0

  const pickFarmer = (id: number | null) => {
    setFarmerId(id)
    setAmount(null)
    setManual(null)
  }

  const save = async () => {
    const v = await form.validateFields()
    if (!amount || amount <= 0) {
      message.warning(tx('মোট টাকার পরিমাণ দিন।'))
      return
    }
    if (gap !== 0) {
      message.warning(tx('ভাগের যোগফল মোট টাকার সমান হতে হবে।'))
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{ id: number; payment_no: string }>('/combined-payments', {
        ...v,
        farmer_id: farmerId,
        amount,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
        parts: manual ? parts : undefined,
      })
      message.success(tx('সমন্বিত রশিদ {{p0}} তৈরি হয়েছে।', { p0: digits(r.data.payment_no) }))
      for (const key of ['combined-payments', 'receipts', 'invoices', 'loans', 'loan-payments', 'fund-accounts', 'combined-quote', 'day-close']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      navigate(`/payments/combined/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const label = (m: CombinedModule) => q?.modules[m] ?? m
  const dueText = (m: CombinedModule) => {
    if (!q) return ''
    if (m === 'loan') return q.loan ? (q.loan.payable ? tx('কিস্তি বকেয়া ৳{{p0}} (সম্পূর্ণ পরিশোধ ৳{{p1}})', { p0: money(q.loan.due_now), p1: money(q.loan.payoff) }) : tx('ঋণ এখনো বিতরণ হয়নি')) : tx('চলমান ঋণ নেই')
    if (m === 'irrigation') return q.irrigation.invoices.length ? tx('{{p0}}টি ইনভয়েস, বকেয়া ৳{{p1}}', { p0: digits(q.irrigation.invoices.length), p1: money(q.irrigation.due) }) : tx('কোনো বকেয়া নেই')
    if (m === 'share') return q.member_active ? tx('জমা ৳{{p0}}, ন্যূনতম ৳{{p1}}', { p0: money(q.share.balance), p1: money(q.share.min) }) : tx('সক্রিয় সদস্য নন')
    return q.member_active ? tx('বর্তমান জমা ৳{{p0}}', { p0: money(q.savings.balance) }) : tx('সক্রিয় সদস্য নন')
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('সমন্বিত টাকা আদায়')}</h2>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <span>{tx('প্রদানকারী')}:</span>
          <div style={{ width: 420, maxWidth: '80vw' }}>
            <FarmerPicker value={farmerId} onChange={(id) => pickFarmer(id)} initialLabel={q ? `${q.farmer.name_bn} (${q.farmer.farmer_code})` : undefined} placeholder={tx('নাম, কোড, NID বা মোবাইল লিখে খুঁজুন')} />
          </div>
        </Space>
      </Card>

      {!farmerId ? (
        <Alert type="info" showIcon title={tx('চাষি/সদস্য বাছাই করুন। এক রশিদে ঋণের কিস্তি, সেচ চার্জ, শেয়ার ও সঞ্চয় একসাথে নেওয়া যাবে।')} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card title={tx('বকেয়া ও ভাগ')} loading={quote.isLoading}>
              {q && (
                <>
                  <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                    <Descriptions.Item label={tx('নাম')}>{nameOf(q.farmer)}</Descriptions.Item>
                    <Descriptions.Item label={tx('পিতা')}>{q.farmer.father_name}</Descriptions.Item>
                    <Descriptions.Item label={tx('সদস্য নং')}>{q.member ? digits(q.member.member_no) : tx('সদস্য নন')}</Descriptions.Item>
                  </Descriptions>
                  {!q.member_active && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('সক্রিয় সদস্য না হওয়ায় শুধু সেচ চার্জ নেওয়া যাবে; বাড়তি টাকা সঞ্চয়ে রাখা যাবে না।')} />}
                  <Typography.Paragraph type="secondary">
                    {tx('ভাগের ক্রম')}: {[...q.order.map(label), label('savings')].join(' → ')}
                  </Typography.Paragraph>
                  <Table
                    rowKey="m"
                    size="small"
                    pagination={false}
                    dataSource={COMBINED_MODULES.map((m) => ({ m }))}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}>
                          <strong>{tx('মোট')}</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <strong style={{ color: gap !== 0 ? '#cf1322' : undefined }}>৳{money(partsSum)}</strong>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )}
                    columns={[
                      { title: tx('খাত'), width: 110, render: (_, { m }) => <Tag color={MODULE_COLOR[m]}>{label(m)}</Tag> },
                      { title: tx('বকেয়া / অবস্থা'), render: (_, { m }) => dueText(m) },
                      {
                        title: tx('এখন জমা'),
                        width: 160,
                        align: 'right',
                        render: (_, { m }) => (
                          <InputNumber
                            min={0}
                            max={limits[m]}
                            disabled={limits[m] === 0}
                            value={parts[m] || null}
                            style={{ width: 140 }}
                            onChange={(v) => setManual({ ...parts, [m]: Number(v ?? 0) })}
                          />
                        ),
                      },
                    ]}
                  />
                  {manual && (
                    <Space style={{ marginTop: 12 }}>
                      <Tag color="orange">{tx('হাতে ভাগ করা')}</Tag>
                      <Button size="small" icon={<UndoOutlined />} onClick={() => setManual(null)}>
                        {tx('স্বয়ংক্রিয় ভাগে ফিরুন')}
                      </Button>
                    </Space>
                  )}
                  {(q.allocation.unallocated > 0 && !manual) && (
                    <Alert type="error" showIcon style={{ marginTop: 12 }} title={tx('৳{{p0}} কোনো খাতে ভাগ করা যায়নি।', { p0: money(q.allocation.unallocated) })} />
                  )}
                </>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card title={tx('রশিদ')}>
              <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash' }} onFinish={save}>
                <Form.Item label={tx('মোট টাকা')} required extra={totalDue > 0 ? tx('মোট বকেয়া ৳{{p0}}', { p0: money(totalDue) }) : undefined}>
                  <Space.Compact style={{ width: '100%' }}>
                    <InputNumber
                      min={0}
                      prefix="৳"
                      size="large"
                      value={amount}
                      style={{ width: '100%' }}
                      onChange={(v) => {
                        setAmount(v === null ? null : Number(v))
                        setManual(null)
                      }}
                    />
                    <Button size="large" disabled={!totalDue} onClick={() => (setAmount(totalDue), setManual(null))}>
                      {tx('সব বকেয়া')}
                    </Button>
                  </Space.Compact>
                </Form.Item>
                <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} onChange={() => setManual(null)} />
                </Form.Item>
                <Form.Item name="method" label={tx('মাধ্যম')}>
                  <Radio.Group optionType="button" options={Object.entries(METHOD_LABEL).map(([value, l]) => ({ value, label: value === 'other' ? tx('অন্যান্য') : l }))} />
                </Form.Item>
                {method === 'cash' ? (
                  <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('সেচের অংশ সেচ ক্যাশে এবং বাকি অংশ সমিতির ক্যাশে জমা হবে।')} />
                ) : (
                  <>
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                      <Select options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))} />
                    </Form.Item>
                    <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[required(tx('রেফারেন্স দিন'))]} extra={tx('চেক/ডিপোজিট স্লিপ বা মোবাইল লেনদেন নম্বর')}>
                      <Input maxLength={100} />
                    </Form.Item>
                  </>
                )}
                <Form.Item name="remarks" label={tx('মন্তব্য')}>
                  <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
                {gap !== 0 && amount ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('ভাগের যোগফল থেকে মোট টাকা ৳{{p0}} আলাদা।', { p0: money(Math.abs(gap)) })} /> : null}
                <Button type="primary" htmlType="submit" icon={<CheckOutlined />} loading={saving} disabled={!amount || gap !== 0 || !q} block size="large">
                  {tx('টাকা গ্রহণ ও রশিদ তৈরি')}
                </Button>
              </Form>
            </Card>
          </Col>
        </Row>
      )}
    </>
  )
}
