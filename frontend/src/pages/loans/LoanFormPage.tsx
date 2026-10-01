import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, SafetyCertificateOutlined, SendOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import LoanMemberPicker from '../../components/LoanMemberPicker'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { penaltyText, termsText, useLoanMeta, useLoanProducts, type Eligibility, type ScheduleRow } from '../../lib/loans'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import SchedulePreview from './SchedulePreview'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import './loans.css'

type Values = { member_id?: number; product_id?: number; applied_on: Dayjs; amount?: number; purpose?: string; remarks?: string; guarantors?: { member_id?: number; relation?: string }[] }

function Section({ no, icon, title, children }: { no: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="lf-card iv-section">
      <header className="lf-card-head">
        <span className="iv-section-icon">{icon}</span>
        <h3>
          {digits(no)}. {title}
        </h3>
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** Apply for a loan: the member's limit and the likely schedule are shown beside the form; it goes for approval. */
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
  const remarks = Form.useWatch('remarks', form)
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
          params: { amount, interest_rate: product!.interest_rate, frequency: product!.frequency, installments: product!.installments, term_months: product!.term_months ?? undefined },
        })
      ).data,
    enabled: !!product && !!amount && amount > 0,
  })

  const rows = preview.data?.rows ?? []
  const each = rows.length ? rows[0].principal + rows[0].interest : 0
  const interest = preview.data?.total_interest ?? 0
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
    <PageFrame
      crumbs={[{ label: tx('ঋণ'), to: '/loans' }, { label: tx('নতুন ঋণ') }]}
      title={tx('নতুন ঋণ')}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/loans')}>
          {tx('তালিকায় ফিরুন')}
        </Button>
      }
    >
      <div className="ln-form-grid">
        <Form form={form} layout="vertical" className="iv-form sv-form" initialValues={{ applied_on: dayjs(), guarantors: [{}] }}>
          <Section no={1} icon={<UserOutlined />} title={tx('ঋণগ্রহীতা ও ঋণ')}>
            <Form.Item name="member_id" label={tx('ঋণগ্রহীতা সদস্য')} rules={[required(tx('সদস্য বাছাই করুন'))]}>
              <LoanMemberPicker mode="borrower" />
            </Form.Item>
            <div className="iv-grid iv-grid-3">
              <Form.Item name="product_id" label={tx('ঋণের প্ল্যান')} rules={[required(tx('ঋণের প্ল্যান বাছাই করুন'))]}>
                <Select loading={products.isFetching} placeholder={tx('ঋণের প্ল্যান বাছাই করুন')} options={(products.data ?? []).map((p) => ({ value: p.id, label: nameOf(p) }))} />
              </Form.Item>
              <Form.Item name="applied_on" label={tx('আবেদনের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
              <Form.Item name="amount" label={tx('ঋণের পরিমাণ (৳)')} rules={[required(tx('টাকার পরিমাণ দিন'))]} extra={e ? tx('এই সদস্যের ঋণসীমা ৳{{p0}}', { p0: money(e.limit) }) : undefined}>
                <InputNumber min={1} max={e?.limit} precision={2} style={{ width: '100%' }} prefix="৳" placeholder="0.00" />
              </Form.Item>
            </div>
            <Form.Item name="purpose" label={tx('উদ্দেশ্য')}>
              <Input maxLength={300} placeholder={tx('যেমন: বোরো ধান চাষ, সার ও বীজ কেনা')} />
            </Form.Item>
          </Section>

          <Section no={2} icon={<TeamOutlined />} title={tx('জামিনদার ও মন্তব্য')}>
            {product && (
              <Alert
                type="info"
                showIcon
                className="sv-note"
                title={tx('এই ঋণে কমপক্ষে {{p0}} জন জামিনদার লাগবে; একজন সদস্য সর্বোচ্চ {{p1}}টি চলমান ঋণের জামিনদার হতে পারেন।', { p0: digits(product.guarantors_required), p1: digits(meta.data?.max_guarantees ?? '') })}
              />
            )}
            <Form.List name="guarantors">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f, i) => (
                    <div key={f.key} className="ln-guarantor-row">
                      <span className="ln-guarantor-no">{digits(i + 1)}</span>
                      <Form.Item name={[f.name, 'member_id']} className="ln-g-member">
                        <LoanMemberPicker mode="guarantor" exclude={taken} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'relation']} className="ln-g-relation">
                        <Input placeholder={tx('সম্পর্ক')} maxLength={100} />
                      </Form.Item>
                      <Button type="text" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => remove(f.name)} />
                    </div>
                  ))}
                  {fields.length < 5 && (
                    <Button className="iv-add" icon={<PlusOutlined />} onClick={() => add({})}>
                      {tx('জামিনদার যোগ করুন')}
                    </Button>
                  )}
                </>
              )}
            </Form.List>
            <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} style={{ marginTop: 16 }} extra={<span className="iv-count">{tx('{{p0}}/৫০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
              <Input.TextArea rows={2} maxLength={500} placeholder={tx('মন্তব্য লিখুন (যদি থাকে)...')} />
            </Form.Item>
          </Section>

          <div className="iv-actions">
            <Button icon={<CloseOutlined />} onClick={() => navigate('/loans')}>
              {tx('বাতিল')}
            </Button>
            <Button onClick={() => form.resetFields()}>{tx('রিসেট')}</Button>
            <span className="iv-spacer" />
            <Button type="primary" icon={<SendOutlined />} loading={saving} disabled={!!blocked} onClick={submit}>
              {tx('অনুমোদনে পাঠান')}
            </Button>
          </div>
        </Form>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <SafetyCertificateOutlined />
              <h3>{tx('ঋণসীমা')}</h3>
            </header>
            {!e ? (
              <p className="sv-foot-note">{tx('সদস্য ও ঋণের প্ল্যান বাছাই করলে ঋণসীমা দেখা যাবে।')}</p>
            ) : (
              <div className="ln-limit">
                {e.open_loan && (
                  <Alert
                    type="error"
                    showIcon
                    title={
                      <>
                        {tx('এই সদস্যের একটি ঋণ চলমান বা অপেক্ষমাণ আছে:')} <Link to={`/loans/${e.open_loan.id}`}>{digits(e.open_loan.loan_no)}</Link>
                      </>
                    }
                  />
                )}
                {e.member_status !== 'active' && <Alert type="error" showIcon title={tx('শুধু সক্রিয় সদস্য ঋণের আবেদন করতে পারেন।')} />}
                <table className="ln-limit-table">
                  <tbody>
                    <tr>
                      <td>{tx('সঞ্চয়')}</td>
                      <td>৳ {money(e.savings)}</td>
                    </tr>
                    <tr>
                      <td>{tx('শেয়ার')}</td>
                      <td>৳ {money(e.share)}</td>
                    </tr>
                    {e.multiplier !== null && (
                      <tr>
                        <td>{tx('জমার ভিত্তিতে ({{p0}}×)', { p0: digits(e.multiplier) })}</td>
                        <td>৳ {money(e.by_deposit)}</td>
                      </tr>
                    )}
                    <tr>
                      <td>{tx('ধরনের সর্বোচ্চ')}</td>
                      <td>৳ {money(e.product_max)}</td>
                    </tr>
                    <tr className="ln-limit-total">
                      <td>{tx('ঋণসীমা')}</td>
                      <td>৳ {money(e.limit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {product && (
            <section className="id-box">
              <header>
                <CalendarOutlined />
                <h3>{tx('কিস্তির হিসাব')}</h3>
              </header>
              {rows.length > 0 && (
                <div className="ln-limit">
                  <table className="ln-limit-table ln-glance">
                    <tbody>
                      <tr>
                        <td>{tx('প্রতি কিস্তি')}</td>
                        <td>
                          <strong>৳ {money(each)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td>{tx('কিস্তি')}</td>
                        <td>{termsText(product, meta.data?.frequencies)}</td>
                      </tr>
                      <tr>
                        <td>{tx('মোট সুদ')}</td>
                        <td>৳ {money(interest)}</td>
                      </tr>
                      <tr className="ln-limit-total">
                        <td>{tx('মোট ফেরত দিতে হবে')}</td>
                        <td>৳ {money(Number(amount) + interest)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="sv-foot-note">
                {tx('সুদ {{p0}}% বার্ষিক (ফ্ল্যাট)। দেরিতে জরিমানা: {{p1}}। প্রকৃত তারিখ বিতরণের দিন থেকে গণনা হবে।', {
                  p0: digits(Number(product.interest_rate)),
                  p1: penaltyText(product),
                })}
              </p>
              <div className="id-payments">
                <SchedulePreview rows={preview.data?.rows} loading={preview.isFetching} />
              </div>
            </section>
          )}
        </div>
      </div>
    </PageFrame>
  )
}
