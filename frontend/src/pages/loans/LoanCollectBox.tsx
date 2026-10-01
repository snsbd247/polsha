import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, InputNumber } from 'antd'
import { DollarOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import LoanMemberPicker from '../../components/LoanMemberPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import type { LoanMember, Position } from '../../lib/loans'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { MethodFields } from './LoanMoneyModals'
import '../irrigation/invoice-detail.css'
import './loans.css'

type Values = { date: Dayjs; amount?: number; method: string; fund_account_id?: number; reference?: string }

/**
 * Collect an instalment in one place: find the member, see what is due
 * today (instalment + penalty), take the money. Any amount is split by the
 * system — penalty first, then interest, then principal.
 */
export default function LoanCollectBox() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [member, setMember] = useState<LoanMember | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<Values>()
  const date: Dayjs | undefined = Form.useWatch('date', form)
  const day = date?.format('YYYY-MM-DD')
  const loan = member?.open_loan?.status === 'active' ? member.open_loan : null

  const pos = useQuery({
    queryKey: ['loan-position', loan?.id, day],
    queryFn: async () => (await api.get<Position>(`/loans/${loan!.id}/position`, { params: { date: day } })).data,
    enabled: !!loan && !!day,
  })
  const p = pos.data
  // nothing due yet: the next instalment is what the member usually brings
  const next = p?.installments.find((i) => i.outstanding > 0)
  useEffect(() => {
    if (p) form.setFieldValue('amount', p.due_now || next?.outstanding || undefined)
  }, [p, next, form])

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v || !loan) return
    setSaving(true)
    try {
      const res = await api.post<{ id: number; message: string }>(`/loans/${loan.id}/payments`, {
        ...v,
        date: v.date.format('YYYY-MM-DD'),
        fund_account_id: v.method !== 'cash' ? v.fund_account_id : null,
      })
      message.success(res.data.message)
      queryClient.invalidateQueries({ queryKey: ['loan-payments'] })
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      navigate(`/loans/payments/${res.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const instalment = p ? Math.max(0, Math.round((p.due_now - p.penalty_due) * 100) / 100) : 0

  return (
    <section className="id-box ln-collect">
      <header>
        <WalletFilled />
        <h3>{tx('কিস্তি আদায় নিন')}</h3>
      </header>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash' }} className="ln-collect-form">
        <div className="ln-collect-grid">
          <Form.Item label={tx('সদস্য')} className="ln-collect-member">
            <LoanMemberPicker
              mode="borrower"
              value={member?.id ?? null}
              onChange={(_, row) => {
                setMember(row ?? null)
                form.setFieldValue('amount', undefined)
              }}
            />
          </Form.Item>
          <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </div>

        {member && !loan && (
          <Alert
            type="warning"
            showIcon
            title={
              member.open_loan ? (
                <>
                  {tx('এই সদস্যের ঋণ এখনো চালু হয়নি (বিতরণ বাকি বা অপেক্ষমাণ):')} <Link to={`/loans/${member.open_loan.id}`}>{digits(member.open_loan.loan_no)}</Link>
                </>
              ) : (
                tx('এই সদস্যের কোনো চলমান ঋণ নেই।')
              )
            }
          />
        )}

        {loan && p && (
          <>
            <div className="ln-due">
              <span>
                {tx('ঋণ')} <Link to={`/loans/${loan.id}`}>{digits(loan.loan_no)}</Link> · {nameOf(member?.farmer)}
              </span>
              <div className="ln-due-sum">
                <div>
                  <small>{tx('কিস্তি')}</small>
                  <b>৳ {money(instalment)}</b>
                </div>
                <i>+</i>
                <div>
                  <small>{tx('জরিমানা')}</small>
                  <b>৳ {money(p.penalty_due)}</b>
                </div>
                <i>=</i>
                <div className="ln-due-total">
                  <small>{tx('আজ দিতে হবে')}</small>
                  <b>৳ {money(p.due_now)}</b>
                </div>
              </div>
              <small className="ln-due-note">
                {p.oldest_overdue ? tx('{{p0}} থেকে বকেয়া ({{p1}} দিন)', { p0: fmtDate(p.oldest_overdue), p1: digits(p.days_overdue) }) + ' · ' : ''}
                {!p.due_now && next ? tx('পরের কিস্তি ৳{{p0}} — {{p1}}', { p0: money(next.outstanding), p1: fmtDate(next.due_date) }) + ' · ' : ''}
                {tx('পুরো ঋণ শোধে ৳{{p0}}', { p0: money(p.payoff) })}
              </small>
            </div>
            <div className="ln-collect-grid">
              <Form.Item name="amount" label={tx('জমার টাকা')} rules={[required(tx('টাকার পরিমাণ দিন'))]} extra={tx('কম বা বেশি দিলেও চলবে — সিস্টেম নিজে কিস্তিতে ভাগ করবে।')}>
                <InputNumber min={0.01} max={p.payoff} precision={2} style={{ width: '100%' }} prefix="৳" size="large" />
              </Form.Item>
              <div className="ln-collect-method">
                <MethodFields open />
              </div>
            </div>
            <Button type="primary" size="large" icon={<DollarOutlined />} loading={saving} onClick={save}>
              {tx('আদায় নিন ও রশিদ দিন')}
            </Button>
          </>
        )}
        {!member && <p className="sv-foot-note">{tx('নাম, সদস্য নং বা মোবাইল দিয়ে সদস্য খুঁজুন — আজ কত দিতে হবে তা সাথে সাথে দেখাবে।')}</p>}
      </Form>
    </section>
  )
}
