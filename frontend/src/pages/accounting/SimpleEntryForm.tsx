import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Radio, Select } from 'antd'
import { CalendarOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions, useFunds } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

type Kind = 'expense' | 'income' | 'transfer'
const VOUCHER: Record<Kind, string> = { expense: 'payment', income: 'receipt', transfer: 'contra' }

/**
 * An entry without debits and credits: money spent on a head, money received
 * for a head, or money moved between cash and bank. The two lines are made
 * here; the voucher then goes for approval like any journal.
 */
export default function SimpleEntryForm() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { data: accounts } = useAccountOptions()
  const { data: funds } = useFunds()

  const kind: Kind = Form.useWatch('kind', form) ?? 'expense'
  const amount: number | undefined = Form.useWatch('amount', form)
  const headId: number | undefined = Form.useWatch('head_id', form)
  const fromId: number | undefined = Form.useWatch('from_id', form)
  const toId: number | undefined = Form.useWatch('to_id', form)

  const heads = (accounts ?? []).filter((a) => a.type === (kind === 'income' ? 'income' : 'expense'))
  const fundOptions = (funds ?? []).map((f) => ({ value: f.id, label: `${nameOf(f)}${f.bank ? ` (${digits(f.bank.account_no)})` : ''} — ৳ ${money(f.closing)}` }))
  const name = (id?: number) => {
    const a = (accounts ?? []).find((x) => x.id === id)
    return a ? nameOf(a) : '—'
  }
  const fundOf = (id?: number) => (funds ?? []).find((f) => f.id === id)
  const short = kind !== 'income' && fromId && amount ? Number(fundOf(fromId)?.closing ?? 0) < amount : false

  // what the voucher will say, in plain words
  const plain =
    kind === 'expense'
      ? tx('খরচ — {{p0}}, {{p1}} থেকে', { p0: name(headId), p1: name(fromId) })
      : kind === 'income'
        ? tx('আয় — {{p0}}, {{p1}}-এ জমা', { p0: name(headId), p1: name(toId) })
        : tx('স্থানান্তর — {{p0}} থেকে {{p1}}', { p0: name(fromId), p1: name(toId) })

  // the plain sentence only once every part of it is chosen
  const complete = kind === 'expense' ? !!(headId && fromId) : kind === 'income' ? !!(headId && toId) : !!(fromId && toId)

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const amt = Number(v.amount)
    const [debit, credit] = kind === 'expense' ? [v.head_id, v.from_id] : kind === 'income' ? [v.to_id, v.head_id] : [v.to_id, v.from_id]
    setSaving(true)
    try {
      const r = await api.post('/journals', {
        voucher_type: VOUCHER[kind],
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        narration: v.narration || plain,
        lines: [
          { account_id: debit, debit: amt, credit: 0 },
          { account_id: credit, debit: 0, credit: amt },
        ],
      })
      message.success(tx('ভাউচার {{p0}} অনুমোদনের জন্য পাঠানো হয়েছে।', { p0: digits(r.data.voucher_no) }))
      queryClient.invalidateQueries({ queryKey: ['journals'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      navigate(`/accounting/journals/${r.data.id}`)
    } catch (e) {
      applyFormErrors(form, e)
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const fundSelect = (placeholder: string) => <Select options={fundOptions} placeholder={placeholder} showSearch={{ optionFilterProp: 'label' }} />

  return (
    <Form form={form} layout="vertical" className="iv-form sv-form se-form" initialValues={{ kind: 'expense', date: dayjs() }}>
      <section className="lf-card iv-section">
        <div className="lf-card-body">
          <Form.Item name="kind" label={tx('কী হয়েছে?')}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              className="se-kind"
              onChange={() => form.setFieldsValue({ head_id: undefined, from_id: undefined, to_id: undefined })}
              options={[
                { value: 'expense', label: tx('টাকা গেল (খরচ)') },
                { value: 'income', label: tx('টাকা এলো (আয়)') },
                { value: 'transfer', label: tx('নগদ ↔ ব্যাংক') },
              ]}
            />
          </Form.Item>
          <div className="iv-grid se-grid">
            <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
              <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
            <Form.Item name="amount" label={tx('টাকা')} rules={[required(tx('টাকা দিন'))]}>
              <InputNumber min={0.01} precision={2} prefix="৳" style={{ width: '100%' }} />
            </Form.Item>
            {kind !== 'transfer' && (
              <Form.Item name="head_id" label={kind === 'income' ? tx('আয়ের খাত') : tx('খরচের খাত')} rules={[required(tx('খাত বাছাই করুন'))]}>
                <Select options={heads.map((a) => ({ value: a.id, label: accountLabel(a) }))} showSearch={{ filterOption: accountFilter }} placeholder={tx('যেমন: অফিস খরচ, বিদ্যুৎ বিল')} />
              </Form.Item>
            )}
            {kind !== 'income' && (
              <Form.Item name="from_id" label={tx('কোথা থেকে গেল')} rules={[required(tx('কোথা থেকে বাছাই করুন'))]}>
                {fundSelect(tx('নগদ বা ব্যাংক'))}
              </Form.Item>
            )}
            {kind !== 'expense' && (
              <Form.Item
                name="to_id"
                label={tx('কোথায় জমা হলো')}
                rules={[required(tx('কোথায় বাছাই করুন')), { validator: (_, v) => (kind === 'transfer' && v && v === fromId ? Promise.reject(new Error(tx('একই হিসাবে স্থানান্তর হয় না'))) : Promise.resolve()) }]}
              >
                {fundSelect(tx('নগদ বা ব্যাংক'))}
              </Form.Item>
            )}
            <Form.Item name="narration" label={tx('বিবরণ')} className="se-wide">
              <Input maxLength={500} placeholder={complete ? plain : tx('যেমন: অফিস ভাড়া পরিশোধ — সেপ্টেম্বর')} />
            </Form.Item>
          </div>
          {short && <Alert type="warning" showIcon title={tx('এই তহবিলে এত টাকা নেই — অনুমোদনের সময় আটকে যেতে পারে।')} style={{ marginBottom: 10 }} />}
          <Alert
            type="info"
            showIcon
            title={
              <>
                {complete ? plain : tx('খাত আর নগদ/ব্যাংক বাছাই করুন')}
                {complete && amount ? ` — ৳ ${money(amount)}` : ''}
              </>
            }
            description={tx('ডেবিট-ক্রেডিট সফটওয়্যার নিজে বানাবে। ম্যানেজারের অনুমোদনের পর হিসাবে উঠবে।')}
          />
        </div>
      </section>
      <div className="iv-actions">
        <Button icon={<CloseOutlined />} onClick={() => navigate('/accounting/journals')}>
          {tx('বাতিল')}
        </Button>
        <span className="iv-spacer" />
        <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={save}>
          {tx('অনুমোদনের জন্য পাঠান')}
        </Button>
      </div>
    </Form>
  )
}
