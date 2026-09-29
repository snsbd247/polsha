import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Empty, Form, Input, InputNumber, Select } from 'antd'
import { ArrowLeftOutlined, CalculatorFilled, CalendarOutlined, CheckCircleFilled, CloseOutlined, EnvironmentOutlined, FileTextFilled, PhoneOutlined, SaveOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, allocate, round2, type DueInvoice, type Person, type ReceiptFund } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/bulk-invoice.css'
import './collect.css'

type Dues = { farmer: Person; invoices: DueInvoice[]; total_due: number }
type FarmerCard = { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null; village: string | null; mouza: string | null }

/** Enter a hand-written receipt from before the system: the old receipt number, the farmer, the bills it paid. */
export default function OldReceiptFormPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [sp] = useSearchParams()
  const [form] = Form.useForm()
  const [farmerId, setFarmerId] = useState<number | null>(Number(sp.get('farmer_id')) || null)
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [amounts, setAmounts] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  const remarks: string | undefined = Form.useWatch('remarks', form)
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const lump: number | null | undefined = Form.useWatch('amount', form)

  const dues = useQuery({ queryKey: ['receipt-dues', farmerId], queryFn: async () => (await api.get<Dues>('/receipts/dues', { params: { farmer_id: farmerId } })).data, enabled: !!farmerId })
  const card = useQuery({ queryKey: ['farmers', farmerId, 'card'], queryFn: async () => (await api.get<FarmerCard>(`/farmers/${farmerId}`)).data, enabled: !!farmerId })
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data })
  const invoices = dues.data?.invoices ?? []
  const chosen = invoices.filter((i) => picked[i.id])
  const billed = round2(chosen.reduce((s, i) => s + i.amount, 0))
  const paidBefore = round2(chosen.reduce((s, i) => s + i.paid_amount, 0))
  const now = round2(chosen.reduce((s, i) => s + (amounts[i.id] || 0), 0))
  const f = card.data

  // a total typed in is spread over the ticked invoices, oldest first
  useEffect(() => {
    if (lump === undefined || lump === null) return
    setAmounts(allocate(lump, chosen))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lump, JSON.stringify(chosen.map((c) => c.id))])

  const pickFarmer = (id: number | null) => {
    setFarmerId(id)
    setPicked({})
    setAmounts({})
    form.setFieldValue('amount', null)
  }
  const toggle = (i: DueInvoice, on: boolean) => {
    setPicked((p) => ({ ...p, [i.id]: on }))
    setAmounts((a) => ({ ...a, [i.id]: on ? i.due : 0 }))
    form.setFieldValue('amount', null)
  }

  const save = async () => {
    const v = await form.validateFields()
    const items = chosen.filter((i) => (amounts[i.id] || 0) > 0).map((i) => ({ invoice_id: i.id, amount: amounts[i.id] }))
    if (!farmerId || !items.length) {
      message.warning(tx('কৃষক ও অন্তত একটি ইনভয়েস বাছাই করে টাকার পরিমাণ দিন।'))
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{ id: number; receipt_no: string }>('/receipts', {
        farmer_id: farmerId,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        method: v.method,
        fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
        reference: v.reference,
        remarks: [v.remarks, v.more].filter(Boolean).join(' — ') || null,
        is_legacy: true,
        legacy_no: v.legacy_no,
        items,
      })
      message.success(tx('পুরোনো রশিদ {{p0}} এন্ট্রি হয়েছে।', { p0: v.legacy_no }))
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      navigate(`/payments/receipts/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('পুরোনো রশিদ এন্ট্রি'), to: '/payments/collect?legacy=1' }, { label: tx('নতুন পুরোনো রশিদ এন্ট্রি') }]}
      title={tx('নতুন পুরোনো রশিদ এন্ট্রি')}
      subtitle={tx('আগের বছরগুলোতে হাতে আদায় করা সেচের টাকার রশিদ এন্ট্রি করুন।')}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/payments/collect?legacy=1')}>
          {tx('তালিকায় ফিরুন')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" className="iv-form" initialValues={{ date: dayjs(), method: 'cash' }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && e.preventDefault()}>
        <div className="cl-layout or-layout">
          <div className="cl-main">
            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <FileTextFilled className="iv-section-icon" />
                <h3>{digits(1)}. {tx('রশিদের তথ্য')}</h3>
              </header>
              <div className="lf-card-body or-grid4">
                <Form.Item name="legacy_no" label={tx('রশিদ নং')} rules={[{ required: true, message: tx('পুরনো রশিদের নম্বর দিন') }]}>
                  <Input maxLength={50} placeholder="OR-2023-001" />
                </Form.Item>
                <Form.Item name="date" label={tx('রশিদের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
                <Form.Item label={tx('গ্রহণকারী')}>
                  <Input disabled value={nameOf(user ?? { name_bn: '', name_en: null })} />
                </Form.Item>
                <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} extra={<span className="iv-count">{tx('{{p0}}/৩০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
                  <Input.TextArea rows={2} maxLength={300} placeholder={tx('যেমন: পুরোনো রেজিস্টার থেকে এন্ট্রি')} />
                </Form.Item>
              </div>
            </section>

            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <UserOutlined className="iv-section-icon" />
                <h3>{digits(2)}. {tx('কৃষকের তথ্য')}</h3>
              </header>
              <div className="lf-card-body">
                <div className="iv-grid iv-grid-3">
                  <Form.Item label={tx('কৃষক বাছাই')} required>
                    <FarmerPicker value={farmerId} onChange={(id) => pickFarmer(id)} initialLabel={f ? `${f.farmer_code} - ${f.name_bn}` : undefined} placeholder={tx('নাম, আইডি বা মোবাইল দিয়ে কৃষক খুঁজুন...')} />
                  </Form.Item>
                  <Form.Item label={tx('মোবাইল নং')}>
                    <Input disabled prefix={<PhoneOutlined />} value={f?.mobile ? digits(f.mobile) : ''} />
                  </Form.Item>
                  <Form.Item label={tx('মৌজা')}>
                    <Input disabled value={f?.mouza ?? ''} />
                  </Form.Item>
                </div>
                <Form.Item label={tx('ঠিকানা')}>
                  <Input disabled prefix={<EnvironmentOutlined />} value={f?.village ?? ''} />
                </Form.Item>
              </div>
            </section>

            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <FileTextFilled className="iv-section-icon" />
                <h3>{digits(3)}. {tx('ইনভয়েস বাছাই')}</h3>
              </header>
              <div className="lf-card-body">
                {!farmerId ? (
                  <Empty description={tx('কৃষক বাছাই করলে তাঁর বকেয়া ইনভয়েস দেখা যাবে')} image={<SearchOutlined style={{ fontSize: 34, color: '#9ca3af' }} />} />
                ) : !invoices.length ? (
                  <Empty description={tx('এই কৃষকের কোনো বকেয়া ইনভয়েস নেই')} />
                ) : (
                  <table className="iv-charges or-invoices">
                    <thead>
                      <tr>
                        <th>
                          <Checkbox checked={chosen.length === invoices.length} indeterminate={chosen.length > 0 && chosen.length < invoices.length} onChange={(e) => invoices.forEach((i) => toggle(i, e.target.checked))} />
                        </th>
                        <th>#</th>
                        <th>{tx('ইনভয়েস নং')}</th>
                        <th>{tx('মৌসুম')}</th>
                        <th>{tx('মৌজা / দাগ')}</th>
                        <th>{tx('ইনভয়েসের তারিখ')}</th>
                        <th>{tx('টাকা (৳)')}</th>
                        <th>{tx('পরিশোধিত (৳)')}</th>
                        <th>{tx('বকেয়া (৳)')}</th>
                        <th>{tx('এই রশিদে (৳)')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i, k) => (
                        <tr key={i.id}>
                          <td>
                            <Checkbox checked={!!picked[i.id]} onChange={(e) => toggle(i, e.target.checked)} />
                          </td>
                          <td>{digits(k + 1)}</td>
                          <td>{digits(i.invoice_no)}</td>
                          <td>{i.season}</td>
                          <td>
                            {i.mouza} / {digits(i.dag_no ?? '')}
                          </td>
                          <td>{fmtDate(i.invoice_date)}</td>
                          <td>{money(i.amount)}</td>
                          <td>{money(i.paid_amount)}</td>
                          <td>{money(i.due)}</td>
                          <td>
                            <InputNumber min={0} max={i.due} disabled={!picked[i.id]} value={amounts[i.id] || null} className="cl-pay" onChange={(v) => setAmounts((a) => ({ ...a, [i.id]: Math.min(i.due, Number(v ?? 0)) }))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <CheckCircleFilled className="iv-section-icon" />
                <h3>{digits(4)}. {tx('পরিশোধের বিবরণ')}</h3>
              </header>
              <div className="lf-card-body">
                <div className="or-grid4">
                  <Form.Item label={tx('মোট ইনভয়েসের টাকা (৳)')}>
                    <Input disabled value={money(billed)} />
                  </Form.Item>
                  <Form.Item name="amount" label={tx('পরিশোধের টাকা (৳)')} extra={tx('দিলে বাছাই করা ইনভয়েসে ভাগ হবে')}>
                    <InputNumber min={0} max={round2(billed - paidBefore)} style={{ width: '100%' }} placeholder={money(now)} />
                  </Form.Item>
                  <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')} rules={[{ required: true }]}>
                    <Select options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                  {method === 'cash' ? (
                    <Form.Item label={tx('জমা হবে')}>
                      <Input disabled value={tx('সেচ ক্যাশ')} />
                    </Form.Item>
                  ) : (
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[{ required: true, message: tx('হিসাব বাছাই করুন') }]}>
                      <Select options={(funds.data ?? []).filter((a) => (method === 'bank' ? a.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) }))} />
                    </Form.Item>
                  )}
                </div>
                <div className="iv-grid rp-grid2 or-grid2">
                  <Form.Item name="reference" label={tx('রেফারেন্স নং (ঐচ্ছিক)')} rules={[{ required: method !== 'cash', message: tx('রেফারেন্স দিন') }]}>
                    <Input maxLength={100} placeholder={tx('রেফারেন্স নং দিন (যদি থাকে)')} />
                  </Form.Item>
                  <Form.Item name="more" label={tx('অতিরিক্ত মন্তব্য (ঐচ্ছিক)')}>
                    <Input.TextArea rows={2} maxLength={300} showCount placeholder={tx('যেমন: কৃষকের কাছ থেকে সরাসরি আদায় (পুরোনো বকেয়া)')} />
                  </Form.Item>
                </div>
              </div>
            </section>
          </div>

          <aside className="cl-side">
            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <UserOutlined className="iv-section-icon" />
                <h3>{tx('কৃষকের সারাংশ')}</h3>
              </header>
              <dl className="cl-sum">
                <div>
                  <dt>{tx('কৃষক আইডি')}</dt>
                  <dd>{f ? digits(f.farmer_code) : '—'}</dd>
                </div>
                <div>
                  <dt>{tx('কৃষকের নাম')}</dt>
                  <dd>{f ? nameOf(f) : '—'}</dd>
                </div>
                <div>
                  <dt>{tx('মোবাইল নং')}</dt>
                  <dd>{f?.mobile ? digits(f.mobile) : '—'}</dd>
                </div>
                <div>
                  <dt>{tx('মৌজা')}</dt>
                  <dd>{f?.mouza ?? '—'}</dd>
                </div>
                <div>
                  <dt>{tx('মোট বকেয়া')}</dt>
                  <dd>৳ {money(dues.data?.total_due ?? 0)}</dd>
                </div>
              </dl>
            </section>
            <section className="lf-card iv-section">
              <header className="lf-card-head">
                <CalculatorFilled className="iv-section-icon" />
                <h3>{tx('পরিশোধের সারাংশ')}</h3>
              </header>
              <dl className="cl-sum">
                <div>
                  <dt>{tx('মোট ইনভয়েস')}</dt>
                  <dd>{digits(chosen.length)}</dd>
                </div>
                <div>
                  <dt>{tx('মোট টাকা')}</dt>
                  <dd>৳ {money(billed)}</dd>
                </div>
                <div className="cl-now">
                  <dt>{tx('পরিশোধের টাকা')}</dt>
                  <dd>৳ {money(now)}</dd>
                </div>
                <div>
                  <dt>{tx('আগে পরিশোধিত')}</dt>
                  <dd>৳ {money(paidBefore)}</dd>
                </div>
                <div className="cl-now">
                  <dt>{tx('বকেয়া থাকবে')}</dt>
                  <dd>৳ {money(round2(billed - paidBefore - now))}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>

        <div className="iv-actions">
          <Button icon={<CloseOutlined />} onClick={() => navigate('/payments/collect?legacy=1')}>
            {tx('বাতিল')}
          </Button>
          <span className="iv-spacer" />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={now <= 0} onClick={save}>
            {tx('পুরোনো রশিদ সংরক্ষণ')}
          </Button>
        </div>
      </Form>
    </PageFrame>
  )
}
