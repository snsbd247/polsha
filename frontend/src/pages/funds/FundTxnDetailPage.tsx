import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Space, Spin, Tag } from 'antd'
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { KIND_LABEL, TXN_STATUS_COLOR, useFundMeta, type FundKind, type FundTxn, type MemberBrief, type Person } from '../../lib/funds'
import { METHOD_LABEL, amountInWords } from '../../lib/irrigation'
import { logoUrl } from '../../lib/settings'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Acc = { code: string; name_bn: string; name_en: string | null } | null
type Detail = FundTxn & {
  cancelled_at: string | null
  posted_at: string | null
  type_label: string
  can_cancel: boolean
  account: { id: number; account_no: string; member_id: number; balance: string; member: (MemberBrief & { farmer: MemberBrief['farmer'] & { father_name: string; mobile: string | null } }) | null }
  fund: Acc
  counter_account: Acc
  journal: { id: number; voucher_no: string; status: string; reversed_by: { id: number; voucher_no: string } | null } | null
  creator: Person
  pair: { id: number; txn_no: string; account: { id: number; account_no: string; member: MemberBrief | null } | null } | null
  run: { id: number; run_no: string; title: string } | null
  society: { name_bn: string; name_en: string | null; address: string | null; phone: string | null; registration_no: string | null; logo: string | null }
}

export default function FundTxnDetailPage({ kind }: { kind: FundKind }) {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useFundMeta(kind)
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()

  const { data: t, isLoading } = useQuery({ queryKey: ['fund-txn', kind, id], queryFn: async () => (await api.get<Detail>(`/funds/${kind}/transactions/${id}`)).data })
  if (isLoading || !t) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/funds/${kind}/transactions/${t.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['fund-txn', kind] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const amount = Number(t.amount)
  const farmer = t.account.member?.farmer
  const title = t.direction === 'in' ? tx('{{p0}} জমার রশিদ', { p0: KIND_LABEL[kind] }) : tx('{{p0}} খরচের রশিদ', { p0: KIND_LABEL[kind] })

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('লেনদেন {{p0}}', { p0: digits(t.txn_no) })} <Tag color={TXN_STATUS_COLOR[t.status]}>{meta.data?.statuses[t.status] ?? t.status}</Tag>
        </h2>
        <Space wrap>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {t.can_cancel && can(`${kind}.create`) && (
            <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
              {tx('লেনদেন বাতিল')}
            </Button>
          )}
        </Space>
      </div>

      {t.status === 'pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('এই লেনদেন অনুমোদনের অপেক্ষায় — অনুমোদনের পর হিসাবে যোগ হবে।')} />}
      {t.status === 'cancel_pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: t.cancel_reason ?? '' })} />}
      {t.status === 'cancelled' && (
        <Alert className="no-print" type="error" showIcon style={{ marginBottom: 16 }} title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(t.cancelled_at), p1: t.cancel_reason ?? '' })} />
      )}

      <div className="receipt-paper">
        {t.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
        {t.status === 'pending' && <div className="receipt-stamp">{tx('অনুমোদনের অপেক্ষায়')}</div>}
        <div className="receipt-head">
          {t.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="receipt-society">{nameOf(t.society)}</div>
            {t.society.address && <div>{t.society.address}</div>}
            <div>
              {t.society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(t.society.registration_no) })}
              {t.society.registration_no && t.society.phone && ' · '}
              {t.society.phone && tx('ফোন: {{p0}}', { p0: digits(t.society.phone) })}
            </div>
            <div className="receipt-title">{title}</div>
          </div>
        </div>

        <table className="receipt-meta">
          <tbody>
            <tr>
              <td>
                {tx('লেনদেন নং')}: <strong>{digits(t.txn_no)}</strong>
              </td>
              <td style={{ textAlign: 'right' }}>
                {tx('তারিখ')}: <strong>{fmtDate(t.date)}</strong>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                {tx('সদস্যের নাম')}: <strong>{nameOf(farmer)}</strong> ({tx('সদস্য নং')} {digits(t.account.member?.member_no)}){farmer && `, ${tx('পিতা: {{p0}}', { p0: farmer.father_name })}`}
                {farmer?.mobile && `, ${tx('মোবাইল')}: ${digits(farmer.mobile)}`}
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                {tx('{{p0}} হিসাব নং', { p0: KIND_LABEL[kind] })}: <strong>{digits(t.account.account_no)}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="receipt-items">
          <thead>
            <tr>
              <th>{tx('বিবরণ')}</th>
              <th>{tx('জমা')}</th>
              <th>{tx('খরচ')}</th>
              <th>{tx('লেনদেনের পর জের')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {t.type_label}
                {t.pair?.account && (
                  <>
                    {' '}
                    — {nameOf(t.pair.account.member?.farmer)} ({digits(t.pair.account.account_no)})
                  </>
                )}
                {t.run && <> — {t.run.title}</>}
              </td>
              <td className="num">{t.direction === 'in' ? money(amount) : ''}</td>
              <td className="num">{t.direction === 'out' ? money(amount) : ''}</td>
              <td className="num">{t.balance_after === null ? '' : money(t.balance_after)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ margin: '8px 0' }}>
          {tx('কথায়')}: <strong>{amountInWords(amount)}</strong>
        </div>
        {t.method && (
          <div>
            {tx('মাধ্যম')}: {METHOD_LABEL[t.method] ?? t.method}
            {t.method !== 'cash' && t.fund && ` — ${accountLabel(t.fund)}`}
            {t.reference && `, ${tx('রেফারেন্স')}: ${digits(t.reference)}`}
          </div>
        )}
        {t.remarks && (
          <div>
            {tx('মন্তব্য')}: {t.remarks}
          </div>
        )}

        <div className="receipt-sign">
          <div>{tx('সদস্যের স্বাক্ষর')}</div>
          <div>
            {nameOf(t.creator)}
            <br />
            {tx('দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর')}
          </div>
        </div>
        <div className="receipt-foot">{tx('কম্পিউটারে তৈরি রশিদ।')}</div>
      </div>

      <Card title={tx('হিসাবের তথ্য')} className="no-print" style={{ marginTop: 16, maxWidth: 800 }}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small">
          <Descriptions.Item label={tx('হিসাব')}>
            <Link to={`/funds/${kind}/accounts/${t.account.id}`}>{digits(t.account.account_no)}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={tx('ভাউচার')}>
            {t.journal &&
              (can('accounting.view') ? <Link to={`/accounting/journals/${t.journal.id}`}>{digits(t.journal.voucher_no)}</Link> : digits(t.journal.voucher_no))}
            {t.journal?.reversed_by && <> ({tx('রিভার্সাল')}: {digits(t.journal.reversed_by.voucher_no)})</>}
          </Descriptions.Item>
          {t.counter_account && <Descriptions.Item label={tx('বিপরীত হিসাব')}>{accountLabel(t.counter_account)}</Descriptions.Item>}
          {t.pair && (
            <Descriptions.Item label={tx('জোড়া লেনদেন')}>
              <Link to={`/funds/${kind}/transactions/${t.pair.id}`}>{digits(t.pair.txn_no)}</Link>
            </Descriptions.Item>
          )}
          {t.run && (
            <Descriptions.Item label={tx('বণ্টন')}>
              <Link to={`/funds/distributions/${t.run.id}`}>{digits(t.run.run_no)}</Link>
            </Descriptions.Item>
          )}
          <Descriptions.Item label={tx('এন্ট্রি করেছেন')}>{nameOf(t.creator)}</Descriptions.Item>
          <Descriptions.Item label={tx('এন্ট্রির সময়')}>{fmtDateTime(t.created_at)}</Descriptions.Item>
          {t.posted_at && <Descriptions.Item label={tx('পোস্টিংয়ের সময়')}>{fmtDateTime(t.posted_at)}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <Modal open={cancelling} forceRender title={tx('লেনদেন বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর লেনদেন বাতিল হবে এবং এর ভাউচার রিভার্স হবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
