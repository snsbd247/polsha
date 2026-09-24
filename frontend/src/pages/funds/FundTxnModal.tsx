import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Radio, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundMemberPicker from '../../components/FundMemberPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountFilter, accountLabel, money, useAccountOptions } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { IN_TYPE, type FundKind } from '../../lib/funds'
import { METHOD_LABEL, type ReceiptFund } from '../../lib/irrigation'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

type Props = {
  kind: FundKind
  account: { id: number; account_no: string; member_id: number; available: number }
  type: string | null
  typeLabel?: string
  onClose: () => void
  onDone: (res: { id: number; status: string }) => void
}

/** Deposit / purchase / withdrawal / opening / adjustment / transfer on one account. */
export default function FundTxnModal({ kind, account, type, typeLabel, onClose, onDone }: Props) {
  const { message } = App.useApp()
  const { can } = useAuth()
  const [form] = Form.useForm()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const moneyType = type === IN_TYPE[kind] || type === 'withdrawal'
  const funds = useQuery({
    queryKey: ['receipt-funds'],
    queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data,
    enabled: moneyType && method !== 'cash',
  })
  const canPickCounter = type === 'adjustment' && can(['accounting.view', 'cash.view', 'bank.view'])
  const accounts = useAccountOptions()

  useEffect(() => {
    if (type) form.resetFields()
  }, [type, form])

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      const res = await api.post<{ id: number; status: string; message: string }>(`/funds/${kind}/accounts/${account.id}/transactions`, {
        ...v,
        type,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: moneyType && v.method !== 'cash' ? v.fund_account_id : null,
      })
      message.success(res.data.message)
      onDone(res.data)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const needsApproval = type !== IN_TYPE[kind]

  return (
    <Modal open={!!type} forceRender title={`${typeLabel ?? ''} — ${digits(account.account_no)}`} onCancel={onClose} onOk={save} okText={needsApproval ? tx('অনুমোদনে পাঠান') : tx('সংরক্ষণ')} cancelText={tx('ফিরে যান')}>
      {needsApproval && <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('ম্যানেজারের অনুমোদনের পর হিসাবে যোগ হবে।')} />}
      {type === 'withdrawal' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('উত্তোলনযোগ্য জের: ৳{{p0}}', { p0: money(account.available) })} />}
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(), method: 'cash', direction: 'in' }}>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        {type === 'adjustment' && (
          <Form.Item name="direction" label={tx('দিক')}>
            <Radio.Group
              options={[
                { value: 'in', label: tx('জমা (+)') },
                { value: 'out', label: tx('খরচ (−)') },
              ]}
            />
          </Form.Item>
        )}
        {type === 'transfer' && (
          <Form.Item name="to_member_id" label={tx('প্রাপক সদস্য')} rules={[required(tx('সদস্য বাছাই করুন'))]} extra={tx('প্রাপকের শেয়ার হিসাব না থাকলে অনুমোদনের পর খোলা হবে।')}>
            <FundMemberPicker kind={kind} exclude={[account.member_id]} />
          </Form.Item>
        )}
        <Form.Item name="amount" label={tx('টাকার পরিমাণ')} rules={[required(tx('টাকার পরিমাণ দিন'))]}>
          <InputNumber min={0.01} max={type === 'withdrawal' || type === 'transfer' ? account.available : undefined} precision={2} style={{ width: '100%' }} prefix="৳" />
        </Form.Item>
        {moneyType && (
          <>
            <Form.Item name="method" label={tx('মাধ্যম')}>
              <Select options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            {method !== 'cash' && (
              <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                <Select
                  loading={funds.isFetching}
                  options={(funds.data ?? [])
                    .filter((f) => (method === 'bank' ? f.kind === 'bank' : true))
                    .map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
                />
              </Form.Item>
            )}
          </>
        )}
        {canPickCounter && (
          <Form.Item name="counter_account_id" label={tx('বিপরীত হিসাব')} extra={tx('খালি রাখলে "প্রারম্ভিক জের সমন্বয়" হিসাবে যাবে।')}>
            <Select
              allowClear
              showSearch={{ filterOption: accountFilter }}
              loading={accounts.isFetching}
              options={(accounts.data ?? []).map((a) => ({ value: a.id, label: accountLabel(a) }))}
            />
          </Form.Item>
        )}
        {type !== 'opening' && type !== 'adjustment' && type !== 'transfer' && (
          <Form.Item name="reference" label={tx('রেফারেন্স')}>
            <Input maxLength={100} />
          </Form.Item>
        )}
        <Form.Item name="remarks" label={type === 'adjustment' || type === 'transfer' ? tx('কারণ') : tx('মন্তব্য')} rules={type === 'adjustment' || type === 'transfer' ? [required(tx('কারণ লিখুন'))] : []}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
