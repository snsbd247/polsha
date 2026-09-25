import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, Input, Modal, QRCode, Space, Spin, Table, Tag } from 'antd'
import { PrinterOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { amountInWords } from '../../lib/irrigation'
import { COMBINED_STATUS_COLOR, MODULE_COLOR, type CombinedModule } from '../../lib/phase8'
import { logoUrl, type Society } from '../../lib/settings'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from '../../components/PrintParts'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Source = { type: 'loan_payment' | 'receipt' | 'member_txn'; kind?: string; id: number; no: string; status: string } | null
type Part = { id: number; module: CombinedModule; amount: number; description: string | null; source: Source }
type Detail = {
  id: number
  payment_no: string
  date: string
  payer_name: string
  amount: string
  method: string
  reference: string | null
  remarks: string | null
  status: string
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  verify_token: string
  parts: Part[]
  farmer: { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null } | null
  member: { id: number; member_no: number } | null
  fund: { id: number; code: string; name_bn: string; name_en: string | null } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
  society: Society
  methods: Record<string, string>
  statuses: Record<string, string>
  modules: Record<string, string>
}

const SOURCE_STATUS: Record<string, string> = {
  posted: tx('পোস্ট হয়েছে'),
  approved: tx('অনুমোদিত'),
  pending: tx('অপেক্ষমাণ'),
  cancel_pending: tx('বাতিল অপেক্ষমাণ'),
  cancelled: tx('বাতিলকৃত'),
  reversed: tx('রিভার্স হয়েছে'),
}

const sourceLink = (s: Source) => {
  if (!s) return null
  const to = s.type === 'loan_payment' ? `/loans/payments/${s.id}` : s.type === 'receipt' ? `/payments/receipts/${s.id}` : `/funds/${s.kind}/transactions/${s.id}`
  return <Link to={to}>{digits(s.no)}</Link>
}

export default function CombinedPaymentDetailPage() {
  const { id } = useParams()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: r, isLoading } = useQuery({ queryKey: ['combined-payments', id], queryFn: async () => (await api.get<Detail>(`/combined-payments/${id}`)).data })
  if (isLoading || !r) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/combined-payments/${r.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['combined-payments'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const amount = Number(r.amount)
  const verifyUrl = `${window.location.origin}/verify/combined/${r.verify_token}`

  return (
    <>
      <div className="page-header no-print">
        <h2>
          {tx('সমন্বিত রশিদ {{p0}}', { p0: digits(r.payment_no) })} <Tag color={COMBINED_STATUS_COLOR[r.status]}>{r.statuses[r.status] ?? r.status}</Tag>
        </h2>
        <Space wrap>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          {r.status === 'posted' && can('payment.create') && (
            <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
              {tx('রশিদ বাতিল')}
            </Button>
          )}
        </Space>
      </div>
      {r.status === 'cancel_pending' && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 16 }} title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: r.cancel_reason ?? '' })} />}
      {r.status === 'cancelled' && (
        <Alert className="no-print" type="error" showIcon style={{ marginBottom: 16 }} title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(r.cancelled_at), p1: r.cancel_reason ?? '' })} />
      )}

      <ReceiptPaper society={r.society}>
        {r.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
        <div className="receipt-head">
          {r.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="receipt-society">{nameOf(r.society)}</div>
            <Letterhead society={r.society} />
            {r.society.address && <div style={{ whiteSpace: 'pre-line' }}>{r.society.address}</div>}
            <div>
              {r.society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(r.society.registration_no) })}
              {r.society.registration_no && r.society.phone && ' · '}
              {r.society.phone && tx('ফোন: {{p0}}', { p0: digits(r.society.phone) })}
            </div>
            <div className="receipt-title">{tx('সমন্বিত টাকার রশিদ')}</div>
          </div>
          {r.society.show_qr !== false && <QRCode value={verifyUrl} size={96} bordered={false} />}
        </div>
        <table className="receipt-meta">
          <tbody>
            <tr>
              <td>
                {tx('রশিদ নং')}: <strong>{digits(r.payment_no)}</strong>
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
                    {r.member && `, ${tx('সদস্য নং')}: ${digits(r.member.member_no)}`}
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
              <th>{tx('খাত')}</th>
              <th>{tx('বিবরণ')}</th>
              <th>{tx('টাকা')}</th>
            </tr>
          </thead>
          <tbody>
            {r.parts.map((p, i) => (
              <tr key={p.id}>
                <td>{digits(i + 1)}</td>
                <td>{r.modules[p.module] ?? p.module}</td>
                <td>
                  {p.description}
                  {p.source && <small> ({digits(p.source.no)})</small>}
                </td>
                <td className="num">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: 'right' }}>
                <strong>{tx('মোট জমা')}</strong>
              </td>
              <td className="num">
                <strong>৳{money(amount)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
        <div style={{ margin: '8px 0' }}>
          {tx('কথায়')}: <strong>{amountInWords(amount)}</strong>
        </div>
        <div>
          {tx('মাধ্যম')}: {r.methods[r.method] ?? r.method}
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

      <Card title={tx('খাতভিত্তিক এন্ট্রি')} className="no-print" style={{ marginTop: 16, maxWidth: 800 }}>
        <Table<Part>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={r.parts}
          columns={[
            { title: tx('খাত'), dataIndex: 'module', render: (m: string) => <Tag color={MODULE_COLOR[m]}>{r.modules[m] ?? m}</Tag> },
            { title: tx('মডিউলের রশিদ/লেনদেন'), render: (_, p) => sourceLink(p.source) },
            { title: tx('অবস্থা'), render: (_, p) => (p.source ? (SOURCE_STATUS[p.source.status] ?? p.source.status) : null) },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
          ]}
        />
        <div style={{ marginTop: 8, color: '#888' }}>
          {tx('গ্রহণকারী')}: {nameOf(r.creator)} · {fmtDateTime(r.created_at)}
        </div>
      </Card>

      <Modal open={cancelling} forceRender title={tx('রশিদ বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর সব খাতের অংশ (ঋণ, সেচ, শেয়ার, সঞ্চয়) একসাথে বাতিল ও রিভার্স হবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
