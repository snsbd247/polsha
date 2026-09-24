import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Row, Select, Space } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import LoanMemberPicker from '../../components/LoanMemberPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { useLoanMeta, useLoanProducts, type Eligibility, type ScheduleRow } from '../../lib/loans'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import SchedulePreview from './SchedulePreview'

type Values = { member_id?: number; product_id?: number; applied_on: Dayjs; amount?: number; purpose?: string; remarks?: string; guarantors?: { member_id?: number; relation?: string }[] }

export default function LoanFormPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const meta = useLoanMeta()
  const products = useLoanProducts(true)
  const [form] = Form.useForm<Values>()
  const [saving, setSaving] = useState(false)
  const memberId = Form.useWatch('member_id', form)
  const productId = Form.useWatch('product_id', form)
  const amount = Form.useWatch('amount', form)
  const guarantors = Form.useWatch('guarantors', form) ?? []
  const product = products.data?.find((p) => p.id === productId)

  const elig = useQuery({
    queryKey: ['loan-eligibility', memberId, productId],
    queryFn: async () => (await api.get<Eligibility>('/loans/eligibility', { params: { member_id: memberId, product_id: productId } })).data,
    enabled: !!memberId && !!productId,
  })
  const preview = useQuery({
    queryKey: ['loan-apply-preview', productId, amount],
    queryFn: async () =>
      (
        await api.get<{ rows: ScheduleRow[]; total_interest: number }>('/loan-products/preview', {
          params: { amount, interest_rate: product!.interest_rate, interest_method: product!.interest_method, frequency: product!.frequency, installments: product!.installments, term_months: product!.term_months ?? undefined },
        })
      ).data,
    enabled: !!product && !!amount && amount > 0,
  })

  const e = elig.data
  const blocked = !!e?.open_loan || (e && e.member_status !== 'active')

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      const res = await api.post<{ id: number; message: string }>('/loans', {
        ...v,
        applied_on: v.applied_on.format('YYYY-MM-DD'),
        guarantors: (v.guarantors ?? []).filter((g) => g.member_id),
      })
      message.success(res.data.message)
      navigate(`/loans/${res.data.id}`)
    } catch (err) {
      if (!applyFormErrors(form, err)) message.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const taken = [memberId, ...guarantors.map((g) => g?.member_id)].filter(Boolean) as number[]

  return (
    <>
      <div className="page-header">
        <h2>{tx('ঋণের আবেদন')}</h2>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={13}>
          <Card>
            <Form form={form} layout="vertical" initialValues={{ applied_on: dayjs(), guarantors: [{}] }}>
              <Form.Item name="member_id" label={tx('ঋণগ্রহীতা সদস্য')} rules={[required(tx('সদস্য বাছাই করুন'))]}>
                <LoanMemberPicker mode="borrower" />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} md={14}>
                  <Form.Item name="product_id" label={tx('ঋণের ধরন')} rules={[required(tx('ঋণের ধরন বাছাই করুন'))]}>
                    <Select loading={products.isFetching} options={(products.data ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${nameOf(p)}` }))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={10}>
                  <Form.Item name="applied_on" label={tx('আবেদনের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                name="amount"
                label={tx('ঋণের পরিমাণ')}
                rules={[required(tx('টাকার পরিমাণ দিন'))]}
                extra={e ? tx('এই সদস্যের ঋণসীমা ৳{{p0}}', { p0: money(e.limit) }) : undefined}
              >
                <InputNumber min={1} max={e?.limit} precision={2} style={{ width: '100%' }} prefix="৳" />
              </Form.Item>
              <Form.Item name="purpose" label={tx('উদ্দেশ্য')}>
                <Input maxLength={300} placeholder={tx('যেমন: বোরো ধান চাষ, সার ও বীজ কেনা')} />
              </Form.Item>

              <Form.Item
                label={tx('জামিনদার')}
                extra={product ? tx('এই ঋণে কমপক্ষে {{p0}} জন জামিনদার লাগবে; একজন সদস্য সর্বোচ্চ {{p1}}টি চলমান ঋণের জামিনদার হতে পারেন।', { p0: digits(product.guarantors_required), p1: digits(meta.data?.max_guarantees ?? '') }) : undefined}
              >
                <Form.List name="guarantors">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} align="start" style={{ display: 'flex', width: '100%' }} className="guarantor-row">
                          <Form.Item name={[f.name, 'member_id']} style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
                            <LoanMemberPicker mode="guarantor" exclude={taken} />
                          </Form.Item>
                          <Form.Item name={[f.name, 'relation']} style={{ width: 140, marginBottom: 8 }}>
                            <Input placeholder={tx('সম্পর্ক')} maxLength={100} />
                          </Form.Item>
                          <Button icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => remove(f.name)} />
                        </Space>
                      ))}
                      {fields.length < 5 && (
                        <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>
                          {tx('জামিনদার যোগ করুন')}
                        </Button>
                      )}
                    </>
                  )}
                </Form.List>
              </Form.Item>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
              <Space>
                <Button type="primary" loading={saving} disabled={!!blocked} onClick={submit}>
                  {tx('অনুমোদনে পাঠান')}
                </Button>
                <Button onClick={() => navigate('/loans')}>{tx('ফিরে যান')}</Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={11}>
          {e && (
            <Card size="small" title={tx('ঋণসীমা')} style={{ marginBottom: 16 }}>
              {e.open_loan && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={
                    <>
                      {tx('এই সদস্যের একটি ঋণ চলমান বা অপেক্ষমাণ আছে:')} <Link to={`/loans/${e.open_loan.id}`}>{digits(e.open_loan.loan_no)}</Link>
                    </>
                  }
                />
              )}
              {e.member_status !== 'active' && <Alert type="error" showIcon style={{ marginBottom: 12 }} title={tx('শুধু সক্রিয় সদস্য ঋণের আবেদন করতে পারেন।')} />}
              <Descriptions column={1} size="small">
                <Descriptions.Item label={tx('সঞ্চয়')}>৳{money(e.savings)}</Descriptions.Item>
                <Descriptions.Item label={tx('শেয়ার')}>৳{money(e.share)}</Descriptions.Item>
                {e.multiplier !== null && (
                  <Descriptions.Item label={tx('জমার ভিত্তিতে ({{p0}}×)', { p0: digits(e.multiplier) })}>৳{money(e.by_deposit)}</Descriptions.Item>
                )}
                <Descriptions.Item label={tx('ধরনের সর্বোচ্চ')}>৳{money(e.product_max)}</Descriptions.Item>
                <Descriptions.Item label={<strong>{tx('ঋণসীমা')}</strong>}>
                  <strong>৳{money(e.limit)}</strong>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}
          {product && (
            <Card size="small" title={tx('কিস্তির তালিকা (সম্ভাব্য)')}>
              <div style={{ marginBottom: 8, color: '#666' }}>
                {tx('সুদ {{p0}}% বার্ষিক ({{p1}}), জরিমানা {{p2}}% মাসিক — ছাড় {{p3}} দিন। প্রকৃত তারিখ বিতরণের দিন থেকে গণনা হবে।', {
                  p0: digits(Number(product.interest_rate)),
                  p1: meta.data?.methods[product.interest_method] ?? '',
                  p2: digits(Number(product.penalty_rate)),
                  p3: digits(product.grace_days),
                })}
              </div>
              <SchedulePreview rows={preview.data?.rows} loading={preview.isFetching} />
            </Card>
          )}
        </Col>
      </Row>
    </>
  )
}
