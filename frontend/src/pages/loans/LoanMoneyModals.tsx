import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, type ReceiptFund } from '../../lib/irrigation'
import type { Position } from '../../lib/loans'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

type Loan = { id: number; loan_no: string; amount: string; applied_on: string; disbursed_on: string | null; frequency: string }

/** Method + cash/bank account fields shared by disbursement and repayment. */
export function MethodFields({ open }: { open: boolean }) {
  const form = Form.useFormInstance()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const funds = useQuery({ queryKey: ['loan-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/loans/funds')).data, enabled: open && method !== 'cash' })
  return (
    <>
      <Form.Item name="method" label={tx('মাধ্যম')}>
        <Select options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
      </Form.Item>
      {method !== 'cash' && (
        <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
          <Select
            loading={funds.isFetching}
            options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
          />
        </Form.Item>
      )}
      <Form.Item name="reference" label={tx('রেফারেন্স')} extra={method !== 'cash' ? tx('চেক/ট্রানজেকশন নং') : undefined}>
        <Input maxLength={100} />
      </Form.Item>
    </>
  )
}

const payload = (v: Record<string, unknown>) => ({
  ...v,
  date: (v.date as Dayjs).format('YYYY-MM-DD'),
  first_due_on: v.first_due_on ? (v.first_due_on as Dayjs).format('YYYY-MM-DD') : undefined,
  fund_account_id: v.method !== 'cash' ? v.fund_account_id : null,
})

export function DisburseModal({ loan, open, onClose, onDone }: { loan: Loan; open: boolean; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      const res = await api.post<{ message: string }>(`/loans/${loan.id}/disburse`, payload(v))
      message.success(res.data.message)
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <Modal open={open} forceRender title={tx('ঋণ বিতরণ — {{p0}}', { p0: digits(loan.loan_no) })} onCancel={onClose} onOk={save} okText={tx('বিতরণ করুন')} cancelText={tx('ফিরে যান')}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('৳{{p0}} সমিতির তহবিল থেকে সদস্যকে দেওয়া হবে এবং কিস্তির তালিকা তৈরি হবে।', { p0: money(loan.amount) })} />
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash' }}>
        <Form.Item name="date" label={tx('বিতরণের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs(loan.applied_on), 'day')} />
        </Form.Item>
        <MethodFields open={open} />
        <Form.Item name="first_due_on" label={tx('প্রথম কিস্তির তারিখ')} extra={tx('খালি রাখলে কিস্তির ধরন অনুযায়ী নিজে থেকে বসবে।')}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function PayModal({ loan, open, onClose, onDone }: { loan: Loan; open: boolean; onClose: () => void; onDone: (paymentId: number) => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const date: Dayjs | undefined = Form.useWatch('date', form)
  const day = date?.format('YYYY-MM-DD')
  const pos = useQuery({
    queryKey: ['loan-position', loan.id, day],
    queryFn: async () => (await api.get<Position>(`/loans/${loan.id}/position`, { params: { date: day } })).data,
    enabled: open && !!day,
  })
  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])
  useEffect(() => {
    if (open && pos.data && form.getFieldValue('amount') === undefined) form.setFieldValue('amount', pos.data.due_now || undefined)
  }, [open, pos.data, form])

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      const res = await api.post<{ id: number; message: string }>(`/loans/${loan.id}/payments`, payload(v))
      message.success(res.data.message)
      onDone(res.data.id)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const p = pos.data
  return (
    <Modal open={open} forceRender title={tx('কিস্তি জমা — {{p0}}', { p0: digits(loan.loan_no) })} onCancel={onClose} onOk={save} okText={tx('জমা নিন')} cancelText={tx('ফিরে যান')}>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash' }}>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day') || (!!loan.disbursed_on && d.isBefore(dayjs(loan.disbursed_on), 'day'))} />
        </Form.Item>
        {p && (
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label={tx('জরিমানা')}>৳{money(p.penalty_due)}</Descriptions.Item>
            <Descriptions.Item label={tx('মেয়াদোত্তীর্ণ')}>৳{money(p.overdue_amount)}</Descriptions.Item>
            <Descriptions.Item label={tx('এখন দেয়')}>
              <strong>৳{money(p.due_now)}</strong>
            </Descriptions.Item>
            <Descriptions.Item label={tx('পুরো ঋণ শোধে')}>৳{money(p.payoff)}</Descriptions.Item>
            {p.oldest_overdue && (
              <Descriptions.Item label={tx('সবচেয়ে পুরনো বকেয়া')} span={2}>
                {fmtDate(p.oldest_overdue)} — {tx('{{p0}} দিন', { p0: digits(p.days_overdue) })}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
        <Form.Item name="amount" label={tx('টাকার পরিমাণ')} rules={[required(tx('টাকার পরিমাণ দিন'))]} extra={tx('প্রথমে জরিমানা, তারপর সুদ, তারপর আসল — এই ক্রমে ভাগ হবে।')}>
          <InputNumber min={0.01} max={p?.payoff} precision={2} style={{ width: '100%' }} prefix="৳" />
        </Form.Item>
        <MethodFields open={open} />
        <Form.Item name="remarks" label={tx('মন্তব্য')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
