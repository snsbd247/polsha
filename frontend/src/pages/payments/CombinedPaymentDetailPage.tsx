import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, QRCode, Spin, Table, Tag } from 'antd'
import { AppstoreFilled, ArrowLeftOutlined, BankFilled, CalendarFilled, DatabaseFilled, FileTextFilled, PrinterOutlined, StopOutlined, UnorderedListOutlined, UserOutlined, WalletFilled } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { amountInWords } from '../../lib/irrigation'
import { MODULE_TONE, type CombinedModule } from '../../lib/phase8'
import { logoUrl, type Society } from '../../lib/settings'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from '../../components/PrintParts'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { COMBINED_TONE } from './CombinedPaymentListPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'

const SOURCE_TONE: Record<string, string> = {
  posted: 'fl-tag-green',
  approved: 'fl-tag-green',
  active: 'fl-tag-green',
  pending: 'fl-tag-gold',
  cancel_pending: 'fl-tag-gold',
  cancelled: 'll-gray',
  reversed: 'll-gray',
}

type Source = {
  type: 'loan_payment' | 'receipt' | 'member_txn'
  kind?: string
  id: number
  no: string
  status: string
} | null
type Part = {
  id: number
  module: CombinedModule
  amount: number
  description: string | null
  source: Source
}
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
  farmer: {
    id: number
    farmer_code: string
    name_bn: string
    name_en: string | null
    father_name: string
    mobile: string | null
  } | null
  member: { id: number; member_no: number } | null
  fund: {
    id: number
    code: string
    name_bn: string
    name_en: string | null
  } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
  society: Society
  methods: Record<string, string>
  statuses: Record<string, string>
  modules: Record<string, string>
}

const SOURCE_STATUS: Record<string, string> = {
  posted: tx('পোস্ট হয়েছে'),
  active: tx('বৈধ'),
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

/** One receipt that split a payment across irrigation, loan, share and savings: details on screen, paper receipt on print. */
export default function CombinedPaymentDetailPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: r, isLoading } = useQuery({
    queryKey: ['combined-payments', id],
    queryFn: async () => (await api.get<Detail>(`/combined-payments/${id}`)).data,
  })
  // opened with ?print=1 from the list: print once the receipt is on screen
  useEffect(() => {
    if (r && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [r, sp])
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
      <div className="no-print">
        <PageFrame
          className="id-page ln-page ln-receipt"
          crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('একত্রিত পেমেন্ট'), to: '/payments/combined' }, { label: tx('রশিদের বিস্তারিত') }]}
          title={tx('রশিদের বিস্তারিত')}
          actions={
            <span className="id-actions">
              <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
                {tx('রশিদ প্রিন্ট')}
              </Button>
              {r.status === 'posted' && can('payment.create') && (
                <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                  {tx('রশিদ বাতিল')}
                </Button>
              )}
              <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/payments/combined')}>
                {tx('তালিকায় ফিরুন')}
              </Button>
            </span>
          }
        >
          {r.status === 'cancel_pending' && (
            <Alert
              className="id-alert"
              type="warning"
              showIcon
              title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', {
                p0: r.cancel_reason ?? '',
              })}
            />
          )}
          {r.status === 'cancelled' && (
            <Alert
              className="id-alert"
              type="error"
              showIcon
              title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', {
                p0: fmtDateTime(r.cancelled_at),
                p1: r.cancel_reason ?? '',
              })}
            />
          )}

          <div className="id-top">
            <div className="id-hero">
              <span className="id-hero-icon">
                <FileTextFilled />
              </span>
              <div>
                <small>{tx('রশিদ নং')}</small>
                <strong>{digits(r.payment_no)}</strong>
                <Tag className={`fl-tag ${COMBINED_TONE[r.status] ?? 'll-gray'}`}>● {r.statuses[r.status] ?? r.status}</Tag>
              </div>
            </div>
            <Fact icon={<CalendarFilled />} label={tx('তারিখ')} color="#1769e0" tint="#e4edfd">
              <strong>{fmtDate(r.date)}</strong>
            </Fact>
            <Fact icon={<DatabaseFilled />} label={tx('মোট জমা')} color="#1f9d55" tint="#dcf3e5">
              <strong>৳ {money(amount)}</strong>
            </Fact>
            <Fact icon={<AppstoreFilled />} label={tx('খাত')} color="#8b3fe0" tint="#efe4fc">
              <strong>{digits(r.parts.length)}</strong>
            </Fact>
            <Fact icon={<WalletFilled />} label={tx('মাধ্যম')} color="#f08c00" tint="#fdefd6">
              <strong>{r.methods[r.method] ?? r.method}</strong>
            </Fact>
          </div>

          <div className="id-two">
            <Box icon={<UserOutlined />} title={tx('প্রদানকারী')}>
              <KV
                rows={[
                  [tx('নাম'), r.farmer ? <Link to={`/farmers/${r.farmer.id}`}>{nameOf(r.farmer)}</Link> : r.payer_name],
                  [tx('কৃষক আইডি'), r.farmer ? digits(r.farmer.farmer_code) : '—'],
                  [tx('সদস্য নং'), r.member ? digits(r.member.member_no) : '—'],
                  [tx('পিতার নাম'), r.farmer?.father_name || '—'],
                  [tx('মোবাইল নং'), r.farmer?.mobile ? digits(r.farmer.mobile) : '—'],
                ]}
              />
            </Box>
            <Box icon={<BankFilled />} title={tx('জমার তথ্য')}>
              <KV
                rows={[
                  [tx('মাধ্যম'), `${r.methods[r.method] ?? r.method}${r.method !== 'cash' && r.fund ? ` — ${accountLabel(r.fund)}` : ''}`],
                  [tx('রেফারেন্স'), r.reference ? digits(r.reference) : '—'],
                  [tx('এন্ট্রি করেছেন'), `${nameOf(r.creator)} · ${fmtDateTime(r.created_at)}`],
                  [tx('মন্তব্য'), r.remarks || '—'],
                ]}
              />
            </Box>
          </div>

          <Box icon={<UnorderedListOutlined />} title={tx('খাতভিত্তিক এন্ট্রি')}>
            <Table<Part>
              rowKey="id"
              size="small"
              className="id-payments"
              pagination={false}
              dataSource={r.parts}
              scroll={{ x: 'max-content' }}
              columns={[
                {
                  title: '#',
                  width: 44,
                  align: 'center',
                  render: (_, __, i) => digits(i + 1),
                },
                {
                  title: tx('খাত'),
                  dataIndex: 'module',
                  render: (m: string) => <Tag className={`fl-tag ${MODULE_TONE[m] ?? 'll-gray'}`}>{r.modules[m] ?? m}</Tag>,
                },
                {
                  title: tx('বিবরণ'),
                  dataIndex: 'description',
                  render: (v: string | null) => v || '—',
                },
                {
                  title: tx('মডিউলের রশিদ/লেনদেন'),
                  render: (_, p) => sourceLink(p.source) ?? '—',
                },
                {
                  title: tx('অবস্থা'),
                  render: (_, p) => (p.source ? <Tag className={`fl-tag ${SOURCE_TONE[p.source.status] ?? 'll-gray'}`}>{SOURCE_STATUS[p.source.status] ?? p.source.status}</Tag> : '—'),
                },
                {
                  title: tx('টাকা (৳)'),
                  dataIndex: 'amount',
                  align: 'right',
                  render: (v: number) => <strong>{money(v)}</strong>,
                },
              ]}
            />
          </Box>
        </PageFrame>
      </div>

      <div className="print-only">
        <ReceiptPaper society={r.society} doc={{ type: 'combined_payment', id: r.id }}>
          {r.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
          <div className="receipt-head">
            {r.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="receipt-society">{nameOf(r.society)}</div>
              <Letterhead society={r.society} />
              {r.society.address && <div style={{ whiteSpace: 'pre-line' }}>{r.society.address}</div>}
              <div>
                {r.society.registration_no &&
                  tx('নিবন্ধন নং: {{p0}}', {
                    p0: digits(r.society.registration_no),
                  })}
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
      </div>

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
