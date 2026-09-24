import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { App, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions, useFunds } from '../lib/accounting'
import { required } from '../lib/rules'
import { t as tx } from '../lib/i18n'

export type FundTxnKind = 'receipt' | 'payment' | 'transfer'

const TITLE: Record<FundTxnKind, string> = {
  receipt: tx('টাকা জমা (প্রাপ্তি)'),
  payment: tx('টাকা খরচ (পরিশোধ)'),
  transfer: tx('স্থানান্তর (নগদ/ব্যাংক)'),
}

type Props = { kind: FundTxnKind | null; fundId?: number; onClose: () => void; onDone?: (journalId: number) => void }

export default function FundTxnModal({ kind, fundId, onClose, onDone }: Props) {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: funds } = useFunds()
  const { data: accounts } = useAccountOptions()

  useEffect(() => {
    if (kind) {
      form.resetFields()
      form.setFieldsValue({ date: dayjs(), fund_account_id: fundId })
    }
  }, [kind, fundId, form])

  // Cashiers see only cash streams; bank users only what bank.create allows.
  const fundOptions = (funds ?? [])
    .filter((f) => can(f.kind === 'bank' ? 'bank.create' : 'cash.create'))
    .filter((f) => !f.bank || f.bank.is_active)
    .map((f) => ({ value: f.id, label: `${accountLabel(f)} (${tx('জের')} ${money(f.closing)})` }))
  const counterOptions = (accounts ?? [])
    .filter((a) => !a.is_fund)
    .map((a) => ({ value: a.id, label: accountLabel(a) }))

  const save = async () => {
    const v = await form.validateFields()
    try {
      const r = await api.post<{ id: number; voucher_no: string }>(`/funds/${kind}`, { ...v, date: (v.date as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('ভাউচার {{p0}} পোস্ট হয়েছে।', { p0: r.data.voucher_no }))
      queryClient.invalidateQueries({ queryKey: ['funds'] })
      queryClient.invalidateQueries({ queryKey: ['ledger'] })
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['bank-statement'] })
      onClose()
      onDone?.(r.data.id)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <Modal open={!!kind} forceRender title={kind ? TITLE[kind] : ''} onCancel={onClose} onOk={save} okText={tx('পোস্ট করুন')} cancelText={tx('বাতিল')} destroyOnHidden={false}>
      <Form form={form} layout="vertical">
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="fund_account_id" label={kind === 'transfer' ? tx('যেখান থেকে') : tx('নগদ/ব্যাংক হিসাব')} rules={[required(tx('হিসাব নির্বাচন করুন'))]}>
          <Select options={fundOptions} showSearch={{ filterOption: accountFilter }} />
        </Form.Item>
        {kind === 'transfer' ? (
          <Form.Item name="to_account_id" label={tx('যেখানে')} rules={[required(tx('হিসাব নির্বাচন করুন'))]}>
            <Select options={fundOptions} showSearch={{ filterOption: accountFilter }} />
          </Form.Item>
        ) : (
          <Form.Item
            name="counter_account_id"
            label={kind === 'receipt' ? tx('কোন খাত থেকে (আয়/পাওনা)') : tx('কোন খাতে (ব্যয়/দেনা)')}
            rules={[required(tx('খাত নির্বাচন করুন'))]}
          >
            <Select options={counterOptions} showSearch={{ filterOption: accountFilter }} />
          </Form.Item>
        )}
        <Form.Item name="amount" label={tx('পরিমাণ (টাকা)')} rules={[required(tx('পরিমাণ দিন'))]}>
          <InputNumber min={0.01} step={1} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="narration" label={tx('বিবরণ')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Form.Item name="reference" label={tx('রেফারেন্স (চেক/রশিদ নং)')}>
          <Input maxLength={255} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
