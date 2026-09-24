import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, QRCode, Space, Spin, Tag } from 'antd'
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, amountInWords, type Owner } from '../../lib/irrigation'
import { logoUrl, type Society } from '../../lib/settings'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from '../../components/PrintParts'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type User = { id: number; name_bn: string; name_en: string | null } | null
type Item = {
  id: number
  description: string
  amount: string
  invoice: {
    id: number
    invoice_no: string
    season: string | null
    mouza: string | null
    dag_no: string | null
    khatian_no: string | null
    area_decimal: number
    rate: number
    amount: number
    due_after: number
    owners: Owner[]
    cultivation_type: string
  } | null
}
type Detail = {
  id: number
  receipt_no: string
  date: string
  payer_name: string
  amount: string
  method: string
  reference: string | null
  is_legacy: boolean
  legacy_no: string | null
  status: string
  remarks: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  verify_token: string
  items: Item[]
  farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null } | null
  fund: { id: number; code: string; name_bn: string; name_en: string | null } | null
  journal: { id: number; voucher_no: string; status: string; reversed_by: { id: number; voucher_no: string } | null } | null
  creator: User
  canceller: User
  society: Society
}

export default function ReceiptDetailPage() {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()

  const { data: r, isLoading } = useQuery({ queryKey: ['receipts', id], queryFn: async () => (await api.get<Detail>(`/receipts/${id}`)).data })
  if (isLoading || !r) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/receipts/${r.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const verifyUrl = `${window.location.origin}/verify/receipt/${r.verify_token}`
  const amount = Number(r.amount)
  const showDue = r.society.show_due !== false

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('রশিদ {{p0}}', { p0: digits(r.receipt_no) })} <Tag color={RECEIPT_STATUS_COLOR[r.status]}>{RECEIPT_STATUS_LABEL[r.status] ?? r.status}</Tag>
        </h2>
        <Space wrap>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {r.status === 'active' && can('payment.create') && (
            <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
              {tx('রশিদ বাতিল')}
            </Button>
          )}
        </Space>
      </div>

      {r.status === 'cancel_pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: r.cancel_reason ?? '' })} />}
      {r.status === 'cancelled' && (
        <Alert
          className="no-print"
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('বাতিল হয়েছে {{p0}} ({{p1}}) — কারণ: {{p2}}', { p0: fmtDateTime(r.cancelled_at), p1: nameOf(r.canceller), p2: r.cancel_reason ?? '' })}
        />
      )}

      <ReceiptPaper society={r.society}>
        {r.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
        <div className="receipt-head">
          {r.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="receipt-society">{nameOf(r.society)}</div>
            <Letterhead society={r.society} />
            {r.society.address && <div>{r.society.address}</div>}
            <div>
              {r.society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(r.society.registration_no) })}
              {r.society.registration_no && r.society.phone && ' · '}
              {r.society.phone && tx('ফোন: {{p0}}', { p0: digits(r.society.phone) })}
            </div>
            <div className="receipt-title">{tx('টাকার রশিদ — সেচ চার্জ')}</div>
          </div>
          {r.society.show_qr !== false && <QRCode value={verifyUrl} size={96} bordered={false} />}
        </div>

        <table className="receipt-meta">
          <tbody>
            <tr>
              <td>
                {tx('রশিদ নং')}: <strong>{digits(r.receipt_no)}</strong>
                {r.is_legacy && r.legacy_no && <> ({tx('পুরনো রশিদ নং')}: {digits(r.legacy_no)})</>}
              </td>
              <td style={{ textAlign: 'right' }}>
                {tx('তারিখ')}: <strong>{fmtDate(r.date)}</strong>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                {tx('প্রদানকারী')}: <strong>{r.farmer ? nameOf(r.farmer) : r.payer_name}</strong>
                {r.farmer && (
                  <>
                    {' '}
                    ({digits(r.farmer.farmer_code)}), {tx('পিতা: {{p0}}', { p0: r.farmer.father_name })}
                    {r.farmer.mobile && `, ${tx('মোবাইল')}: ${digits(r.farmer.mobile)}`}
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="receipt-items">
          <thead>
            <tr>
              <th>{tx('ক্রম')}</th>
              <th>{tx('বিবরণ')}</th>
              <th>{tx('জমি (শতক)')}</th>
              <th>{tx('রেট')}</th>
              <th>{tx('বিল')}</th>
              <th>{tx('জমা')}</th>
              {showDue && <th>{tx('অবশিষ্ট বকেয়া')}</th>}
            </tr>
          </thead>
          <tbody>
            {r.items.map((it, i) => (
              <tr key={it.id}>
                <td>{digits(i + 1)}</td>
                <td>
                  {it.invoice ? (
                    <>
                      {tx('সেচ চার্জ')} — {it.invoice.season}
                      <br />
                      <small>
                        {tx('ইনভয়েস')} {digits(it.invoice.invoice_no)}; {it.invoice.mouza}, {tx('দাগ')} {digits(it.invoice.dag_no)}
                        {it.invoice.cultivation_type !== 'own' && it.invoice.owners.length > 0 && (
                          <>
                            ; {tx('মালিক')}: {it.invoice.owners.map((o) => nameOf(o)).join(', ')}
                          </>
                        )}
                      </small>
                    </>
                  ) : (
                    it.description
                  )}
                </td>
                <td className="num">{it.invoice ? digits(it.invoice.area_decimal) : ''}</td>
                <td className="num">{it.invoice ? money(it.invoice.rate) : ''}</td>
                <td className="num">{it.invoice ? money(it.invoice.amount) : ''}</td>
                <td className="num">{money(it.amount)}</td>
                {showDue && <td className="num">{it.invoice ? money(it.invoice.due_after) : ''}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ textAlign: 'right' }}>
                <strong>{tx('মোট জমা')}</strong>
              </td>
              <td className="num">
                <strong>৳{money(amount)}</strong>
              </td>
              {showDue && <td />}
            </tr>
          </tfoot>
        </table>

        <div style={{ margin: '8px 0' }}>
          {tx('কথায়')}: <strong>{amountInWords(amount)}</strong>
        </div>
        <div>
          {tx('মাধ্যম')}: {METHOD_LABEL[r.method] ?? r.method}
          {r.method !== 'cash' && r.fund && ` — ${accountLabel(r.fund)}`}
          {r.reference && `, ${tx('রেফারেন্স')}: ${digits(r.reference)}`}
        </div>
        {r.remarks && (
          <div>
            {tx('মন্তব্য')}: {r.remarks}
          </div>
        )}

        <ReceiptSign society={r.society} collector={nameOf(r.creator)} />
        <ReceiptFoot society={r.society} fallback={tx('QR কোড স্ক্যান করে রশিদের সত্যতা যাচাই করুন। কম্পিউটারে তৈরি রশিদ।')} />
      </ReceiptPaper>

      <Card title={tx('হিসাবের তথ্য')} className="no-print" style={{ marginTop: 16, maxWidth: 800 }}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small">
          <Descriptions.Item label={tx('জমা হিসাব')}>{accountLabel(r.fund)}</Descriptions.Item>
          <Descriptions.Item label={tx('ভাউচার')}>
            {r.journal &&
              (can('accounting.view') ? <Link to={`/accounting/journals/${r.journal.id}`}>{digits(r.journal.voucher_no)}</Link> : digits(r.journal.voucher_no))}
            {r.journal?.reversed_by && <> ({tx('রিভার্সাল')}: {digits(r.journal.reversed_by.voucher_no)})</>}
          </Descriptions.Item>
          <Descriptions.Item label={tx('গ্রহণকারী')}>{nameOf(r.creator)}</Descriptions.Item>
          <Descriptions.Item label={tx('এন্ট্রির সময়')}>{fmtDateTime(r.created_at)}</Descriptions.Item>
          {r.items.map((it) =>
            it.invoice ? (
              <Descriptions.Item key={it.id} label={tx('ইনভয়েস')}>
                <Link to={`/irrigation/invoices/${it.invoice.id}`}>{digits(it.invoice.invoice_no)}</Link>
              </Descriptions.Item>
            ) : null,
          )}
        </Descriptions>
      </Card>

      <Modal open={cancelling} forceRender title={tx('রশিদ বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর রশিদ বাতিল হবে, আদায়ের হিসাব রিভার্স হবে এবং ইনভয়েসগুলো আবার বকেয়া দেখাবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
