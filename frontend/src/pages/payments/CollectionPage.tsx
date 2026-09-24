import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Table, Tag } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, allocate, round2, type DueInvoice, type Person, type ReceiptFund } from '../../lib/irrigation'
import { CULTIVATION_COLOR, useLandMeta } from '../../lib/land'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Dues = { farmer: Person; invoices: DueInvoice[]; total_due: number }

export default function CollectionPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const [form] = Form.useForm()
  const [farmerId, setFarmerId] = useState<number | null>(Number(search.get('farmer_id')) || null)
  const [amounts, setAmounts] = useState<Record<number, number>>({})
  const [lump, setLump] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: landMeta } = useLandMeta()

  const dues = useQuery({
    queryKey: ['receipt-dues', farmerId],
    queryFn: async () => (await api.get<Dues>('/receipts/dues', { params: { farmer_id: farmerId } })).data,
    enabled: !!farmerId,
  })
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data })

  const method: string = Form.useWatch('method', form) ?? 'cash'
  const legacy: boolean = Form.useWatch('is_legacy', form) ?? false
  const invoices = dues.data?.invoices ?? []
  const total = round2(invoices.reduce((s, i) => s + (amounts[i.id] || 0), 0))
  const fundOptions = (funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true))

  const pickFarmer = (id: number | null) => {
    setFarmerId(id)
    setAmounts({})
    setLump(null)
  }
  const spread = (sum: number | null) => {
    setLump(sum)
    setAmounts(allocate(sum ?? 0, invoices))
  }

  const save = async () => {
    const v = await form.validateFields()
    const items = invoices.filter((i) => (amounts[i.id] || 0) > 0).map((i) => ({ invoice_id: i.id, amount: amounts[i.id] }))
    if (!items.length) {
      message.warning(tx('অন্তত একটি ইনভয়েসে টাকার পরিমাণ দিন।'))
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{ id: number; receipt_no: string }>('/receipts', {
        ...v,
        farmer_id: farmerId,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
        is_legacy: !!v.is_legacy,
        items,
      })
      message.success(tx('রশিদ {{p0}} তৈরি হয়েছে।', { p0: digits(r.data.receipt_no) }))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
      queryClient.invalidateQueries({ queryKey: ['receipt-dues'] })
      navigate(`/payments/receipts/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const f = dues.data?.farmer

  return (
    <>
      <div className="page-header">
        <h2>{tx('সেচ চার্জ আদায়')}</h2>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <span>{tx('চাষি')}:</span>
          <div style={{ width: 420, maxWidth: '80vw' }}>
            <FarmerPicker value={farmerId} onChange={(id) => pickFarmer(id)} initialLabel={f ? `${f.name_bn} (${f.farmer_code})` : undefined} placeholder={tx('নাম, কোড, NID বা মোবাইল লিখে খুঁজুন')} />
          </div>
        </Space>
      </Card>

      {!farmerId ? (
        <Alert type="info" showIcon title={tx('যে চাষির কাছ থেকে টাকা নেবেন তাকে বাছাই করুন; তাঁর সব বকেয়া ইনভয়েস দেখা যাবে।')} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={15}>
            <Card
              title={tx('বকেয়া ইনভয়েস')}
              loading={dues.isLoading}
              extra={
                invoices.length > 0 && (
                  <Space wrap>
                    <InputNumber
                      min={0}
                      max={dues.data?.total_due}
                      value={lump}
                      prefix="৳"
                      placeholder={tx('মোট জমা')}
                      style={{ width: 150 }}
                      onChange={(v) => spread(v === null ? null : Number(v))}
                    />
                    <Button onClick={() => spread(dues.data?.total_due ?? 0)}>{tx('সব বকেয়া')}</Button>
                  </Space>
                )
              }
            >
              {f && (
                <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                  <Descriptions.Item label={tx('নাম')}>{nameOf(f)}</Descriptions.Item>
                  <Descriptions.Item label={tx('পিতা')}>{f.father_name}</Descriptions.Item>
                  <Descriptions.Item label={tx('মোবাইল')}>{f.mobile ? digits(f.mobile) : '—'}</Descriptions.Item>
                </Descriptions>
              )}
              {invoices.length === 0 ? (
                <Empty description={tx('এই চাষির কোনো বকেয়া নেই')} />
              ) : (
                <Table<DueInvoice>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={invoices}
                  scroll={{ x: 800 }}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={4}>
                        <strong>{tx('মোট')}</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <strong>{money(dues.data?.total_due)}</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <strong>{money(total)}</strong>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                  columns={[
                    { title: tx('ইনভয়েস'), dataIndex: 'invoice_no', render: (v: string, i) => <a href={`/irrigation/invoices/${i.id}`} target="_blank" rel="noreferrer">{digits(v)}</a> },
                    { title: tx('মৌসুম'), dataIndex: 'season' },
                    {
                      title: tx('জমি'),
                      render: (_, i) => (
                        <>
                          {i.mouza} / {digits(i.dag_no)} <Tag color={CULTIVATION_COLOR[i.cultivation_type]}>{landMeta?.cultivation_types[i.cultivation_type] ?? i.cultivation_type}</Tag>
                        </>
                      ),
                    },
                    { title: tx('শেষ তারিখ'), dataIndex: 'due_date', render: (v: string | null) => <span style={{ color: v && dayjs(v).isBefore(dayjs(), 'day') ? '#cf1322' : undefined }}>{fmtDate(v)}</span> },
                    { title: tx('বকেয়া'), dataIndex: 'due', align: 'right', render: (v, i) => <span title={tx('বিল {{p0}}, আদায় {{p1}}', { p0: money(i.amount), p1: money(i.paid_amount) })}>{money(v)}</span> },
                    {
                      title: tx('এখন জমা'),
                      width: 150,
                      align: 'right',
                      render: (_, i) => (
                        <InputNumber
                          min={0}
                          max={i.due}
                          value={amounts[i.id] || null}
                          style={{ width: 130 }}
                          onChange={(v) => {
                            setLump(null)
                            setAmounts((a) => ({ ...a, [i.id]: Number(v ?? 0) }))
                          }}
                        />
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card title={tx('রশিদ')}>
              <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash', is_legacy: false }} onFinish={save}>
                <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
                <Form.Item name="method" label={tx('মাধ্যম')}>
                  <Radio.Group optionType="button" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label: value === 'other' ? tx('অন্যান্য') : label }))} />
                </Form.Item>
                {method === 'cash' ? (
                  <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('নগদ টাকা সেচ ক্যাশে জমা হবে।')} />
                ) : (
                  <>
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                      <Select
                        options={fundOptions.map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
                        notFoundContent={tx('কোনো সক্রিয় ব্যাংক হিসাব নেই')}
                      />
                    </Form.Item>
                    <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[required(tx('রেফারেন্স দিন'))]} extra={tx('চেক/ডিপোজিট স্লিপ বা মোবাইল লেনদেন নম্বর')}>
                      <Input maxLength={100} />
                    </Form.Item>
                  </>
                )}
                <Form.Item name="is_legacy" valuePropName="checked" style={{ marginBottom: legacy ? 8 : undefined }}>
                  <Checkbox>{tx('পুরনো (হাতে লেখা) রশিদ এন্ট্রি')}</Checkbox>
                </Form.Item>
                {legacy && (
                  <Form.Item name="legacy_no" label={tx('পুরনো রশিদ নং')} rules={[required(tx('পুরনো রশিদের নম্বর দিন'))]}>
                    <Input maxLength={50} />
                  </Form.Item>
                )}
                <Form.Item name="remarks" label={tx('মন্তব্য')}>
                  <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
                <div style={{ fontSize: 20, marginBottom: 12 }}>
                  {tx('মোট জমা')}: <strong>৳{money(total)}</strong>
                </div>
                <Button type="primary" htmlType="submit" icon={<CheckOutlined />} loading={saving} disabled={total <= 0} block size="large">
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
