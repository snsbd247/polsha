import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Radio, Row, Select, Table } from 'antd'
import { DollarOutlined } from '@ant-design/icons'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { amountInWords, round2, type ReceiptFund } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import { billLabel, type WaterBill, type WaterConnection } from '../../lib/water'
import './water.css'
import PageFrame from '../../components/PageFrame'

type Dues = {
  connection: Pick<WaterConnection, 'id' | 'connection_no' | 'name_bn' | 'name_en' | 'father_name' | 'mobile' | 'address' | 'status' | 'type' | 'village'> & { fee: number }
  bills: WaterBill[]
  total_due: number
}
type Values = { date: Dayjs; method: string; fund_account_id?: number; reference?: string; remarks?: string; penalty?: number }

/** Takes money for a connection's bills, with an optional penalty, into "পানির নগদ" (or a bank). */
export default function CollectPage() {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<Values>()
  const [lookup, setLookup] = useState('')
  const [amounts, setAmounts] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const connectionId = search.get('connection')

  const found = useQuery({
    queryKey: ['water', 'connection-lookup', lookup],
    queryFn: async () => (await api.get<Paginated<WaterConnection>>('/water/connections', { params: { search: lookup, per_page: 25 } })).data.data,
    enabled: lookup.trim().length > 0,
  })
  const dues = useQuery({
    queryKey: ['water', 'dues', connectionId],
    queryFn: async () => (await api.get<Dues>(`/water/connections/${connectionId}/dues`)).data,
    enabled: !!connectionId,
  })
  const funds = useQuery({ queryKey: ['water', 'funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/water/funds')).data })

  // every open bill is ticked for its full due to start with
  useEffect(() => {
    if (dues.data) setAmounts(Object.fromEntries(dues.data.bills.map((b) => [b.id, b.due])))
  }, [dues.data])

  const method: string = Form.useWatch('method', form) ?? 'cash'
  const penalty = Number(Form.useWatch('penalty', form) ?? 0)
  const picked = useMemo(() => Object.entries(amounts).filter(([, a]) => a > 0), [amounts])
  const subtotal = round2(picked.reduce((s, [, a]) => s + a, 0))
  const total = round2(subtotal + (penalty > 0 ? penalty : 0))
  const fundOptions = (funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true))

  const pick = (id: string | null) => {
    setSearch(id ? { connection: id } : {})
    form.setFieldsValue({ penalty: 0 })
  }

  const save = async (v: Values) => {
    if (!dues.data || !picked.length) return
    setSaving(true)
    try {
      const r = await api.post<{ id: number; receipt_no: string }>('/water/collect', {
        connection_id: dues.data.connection.id,
        date: v.date.format('YYYY-MM-DD'),
        method: v.method,
        fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
        reference: v.reference,
        remarks: v.remarks,
        penalty: penalty > 0 ? penalty : 0,
        items: picked.map(([bill_id, amount]) => ({ bill_id: Number(bill_id), amount })),
      })
      message.success(tx('আদায় হয়েছে — রশিদ {{p0}}', { p0: digits(r.data.receipt_no) }))
      queryClient.invalidateQueries({ queryKey: ['water'] })
      navigate(`/water/receipts/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const c = dues.data?.connection
  const optionOf = (x: Pick<WaterConnection, 'id' | 'connection_no' | 'name_bn' | 'name_en' | 'mobile'>) => ({
    value: x.id,
    label: `${digits(x.connection_no)} — ${nameOf(x)}${x.mobile ? ` (${digits(x.mobile)})` : ''}`,
  })
  const options = (found.data ?? []).map(optionOf)
  // the connection opened from a link stays shown in the box
  if (c && !options.some((o) => o.value === c.id)) options.unshift(optionOf(c))

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('বিল আদায়') }]}
      title={tx('পানির বিল আদায়')}
      subtitle={tx('গ্রাহক খুঁজে বকেয়া বিল বাছাই করুন; দরকারে জরিমানা যোগ করুন। নগদ টাকা "পানির নগদ" তহবিলে যায়।')}
    >
      <Card size="small" style={{ marginBottom: 16 }}>
        <Select
          showSearch={{ filterOption: false, onSearch: setLookup }}
          placeholder={tx('নাম, মোবাইল বা সংযোগ নং লিখে খুঁজুন')}
          style={{ width: '100%', maxWidth: 520 }}
          value={c ? c.id : undefined}
          loading={found.isFetching}
          notFoundContent={lookup ? tx('পাওয়া যায়নি') : null}
          onChange={(id) => pick(id ? String(id) : null)}
          allowClear
          options={options}
        />
      </Card>

      {!connectionId && <Empty description={tx('আদায় করতে আগে গ্রাহক বাছাই করুন')} />}
      {c && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={15}>
            <Card size="small" title={`${nameOf(c)} — ${digits(c.connection_no)}`} style={{ marginBottom: 16 }}>
              <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label={tx('পিতা/স্বামী')}>{c.father_name || '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('মোবাইল')}>{c.mobile ? digits(c.mobile) : '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('গ্রাম / পাড়া')}>{[nameOf(c.village), c.address].filter(Boolean).join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label={tx('ধরন ও মাসিক ফি')}>
                  {nameOf(c.type)} — ৳{money(c.fee)}
                </Descriptions.Item>
              </Descriptions>
              {c.status !== 'active' && <Alert type="warning" showIcon title={tx('সংযোগটি এখন চালু নেই।')} style={{ marginTop: 8 }} />}
            </Card>
            {dues.data && dues.data.bills.length === 0 ? (
              <Empty description={tx('এই সংযোগে কোনো বকেয়া নেই।')} />
            ) : (
              <Table<WaterBill>
                rowKey="id"
                size="small"
                loading={dues.isFetching}
                dataSource={dues.data?.bills}
                pagination={false}
                scroll={{ x: 640 }}
                columns={[
                  {
                    title: '',
                    width: 40,
                    render: (_, b) => <Checkbox checked={(amounts[b.id] ?? 0) > 0} onChange={(e) => setAmounts((a) => ({ ...a, [b.id]: e.target.checked ? b.due : 0 }))} />,
                  },
                  { title: tx('কিসের বিল'), render: (_, b) => billLabel(b) },
                  { title: tx('বিল নং'), dataIndex: 'bill_no', width: 150, render: (v: string) => digits(v) },
                  { title: tx('বকেয়া'), dataIndex: 'due', width: 100, align: 'right', render: money },
                  {
                    title: tx('এখন নেওয়া হবে'),
                    width: 140,
                    render: (_, b) => (
                      <InputNumber
                        size="small"
                        min={0}
                        max={b.due}
                        value={amounts[b.id] ?? 0}
                        onChange={(v) => setAmounts((a) => ({ ...a, [b.id]: round2(Number(v ?? 0)) }))}
                        style={{ width: '100%' }}
                      />
                    ),
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>
                      <strong>{tx('মোট বকেয়া')}</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <strong>{money(dues.data?.total_due)}</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <strong>{money(subtotal)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            )}
          </Col>
          <Col xs={24} lg={9}>
            <Card size="small" title={tx('টাকা গ্রহণ')}>
              <Form form={form} layout="vertical" onFinish={save} initialValues={{ date: dayjs(), method: 'cash', penalty: 0 }}>
                <Form.Item name="penalty" label={tx('জরিমানা (ঐচ্ছিক)')} extra={tx('দেরিতে পরিশোধের জরিমানা; সবচেয়ে পুরোনো বাছাই করা বিলে যোগ হয়।')}>
                  <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="date" label={tx('তারিখ')} rules={[{ required: true }]}>
                      <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="method" label={tx('মাধ্যম')} rules={[{ required: true }]}>
                      <Radio.Group
                        optionType="button"
                        options={[
                          { value: 'cash', label: tx('নগদ') },
                          { value: 'bank', label: tx('ব্যাংক') },
                          { value: 'other', label: tx('অন্যান্য') },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                {method !== 'cash' && (
                  <>
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[{ required: true, message: tx('হিসাব বাছাই করুন') }]}>
                      <Select options={fundOptions.map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))} />
                    </Form.Item>
                    <Form.Item name="reference" label={tx('রেফারেন্স (চেক / লেনদেন নং)')} rules={[{ required: true, message: tx('রেফারেন্স দিন') }]}>
                      <Input maxLength={100} />
                    </Form.Item>
                  </>
                )}
                <Form.Item name="remarks" label={tx('মন্তব্য')}>
                  <Input maxLength={500} />
                </Form.Item>
                <div className="wc-total">
                  <span>{tx('মোট নেওয়া হবে')}</span>
                  <strong>৳ {money(total)}</strong>
                  {total > 0 && <small>{amountInWords(total)}</small>}
                </div>
                <Button type="primary" htmlType="submit" size="large" block icon={<DollarOutlined />} loading={saving} disabled={!picked.length}>
                  {tx('আদায় করে রশিদ দিন')}
                </Button>
              </Form>
            </Card>
          </Col>
        </Row>
      )}
    </PageFrame>
  )
}
