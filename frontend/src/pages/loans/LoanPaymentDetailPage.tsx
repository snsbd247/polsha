import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Spin, Tag } from 'antd'
import { ArrowLeftOutlined, BankFilled, CalendarFilled, CreditCardFilled, DatabaseFilled, FileTextFilled, PercentageOutlined, PrinterOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import type { FarmerBrief, MemberBrief } from '../../lib/funds'
import { METHOD_LABEL, amountInWords } from '../../lib/irrigation'
import { useLoanMeta, type LoanPayment } from '../../lib/loans'
import { logoUrl, type Society } from '../../lib/settings'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from '../../components/PrintParts'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import './loans.css'

const PAYMENT_TONE: Record<string, string> = { posted: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

type Detail = Omit<LoanPayment, 'loan'> & {
  can_cancel: boolean
  loan: {
    id: number
    loan_no: string
    amount: string
    status: string
    product: { name_bn: string; name_en: string | null } | null
    member: (MemberBrief & { farmer: (FarmerBrief & { father_name: string; mobile: string | null }) | null }) | null
  }
  fund: { code: string; name_bn: string; name_en: string | null } | null
  journal: { id: number; voucher_no: string; status: string; reversed_by: { id: number; voucher_no: string } | null } | null
  society: Society
}

/** Printable loan repayment receipt with the penalty / interest / principal split. */
export default function LoanPaymentDetailPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useLoanMeta()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()

  const { data: p, isLoading } = useQuery({ queryKey: ['loan-payment', id], queryFn: async () => (await api.get<Detail>(`/loans/payments/${id}`)).data })
  // opened with ?print=1 from the list: print once the receipt is on screen
  useEffect(() => {
    if (p && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [p, sp])
  if (isLoading || !p) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/loans/payments/${p.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['loan-payment', id] })
      queryClient.invalidateQueries({ queryKey: ['loan', String(p.loan_id)] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const amount = Number(p.amount)
  const farmer = p.loan.member?.farmer
  const parts: [string, string][] = [
    [tx('জরিমানা'), p.penalty],
    [tx('সুদ'), p.interest],
    [tx('আসল'), p.principal],
  ]

  return (
    <>
      <div className="no-print">
        <PageFrame
          className="id-page ln-receipt"
          crumbs={[{ label: tx('ঋণ'), to: '/loans' }, { label: tx('ঋণ পরিশোধ'), to: '/loans/payments' }, { label: tx('রশিদের বিস্তারিত') }]}
          title={tx('রশিদের বিস্তারিত')}
          actions={
            <span className="id-actions">
              <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
                {tx('রশিদ প্রিন্ট')}
              </Button>
              {p.can_cancel && can(['loan.create', 'payment.create']) && (
                <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                  {tx('পরিশোধ বাতিল')}
                </Button>
              )}
              <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(`/loans/${p.loan.id}`)}>
                {tx('ঋণে ফিরুন')}
              </Button>
            </span>
          }
        >
          {p.status === 'cancel_pending' && <Alert className="id-alert" type="warning" showIcon title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: p.cancel_reason ?? '' })} />}
          {p.status === 'cancelled' && <Alert className="id-alert" type="error" showIcon title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(p.cancelled_at), p1: p.cancel_reason ?? '' })} />}

          <div className="id-top">
            <div className="id-hero">
              <span className="id-hero-icon">
                <FileTextFilled />
              </span>
              <div>
                <small>{tx('রশিদ নং')}</small>
                <strong>{digits(p.payment_no)}</strong>
                <Tag className={`fl-tag ${PAYMENT_TONE[p.status] ?? 'll-gray'}`}>● {meta.data?.payment_statuses[p.status] ?? p.status}</Tag>
              </div>
            </div>
            <Fact icon={<CalendarFilled />} label={tx('তারিখ')} color="#1769e0" tint="#e4edfd">
              <strong>{fmtDate(p.date)}</strong>
            </Fact>
            <Fact icon={<DatabaseFilled />} label={tx('মোট জমা')} color="#1f9d55" tint="#dcf3e5">
              <strong>৳ {money(amount)}</strong>
            </Fact>
            <Fact icon={<BankFilled />} label={tx('আসল')} color="#8b3fe0" tint="#efe4fc">
              <strong>৳ {money(p.principal)}</strong>
            </Fact>
            <Fact icon={<PercentageOutlined />} label={tx('সুদ + জরিমানা')} color="#0e9f9a" tint="#d9f4f2">
              <strong>৳ {money(Number(p.interest) + Number(p.penalty))}</strong>
            </Fact>
            <Fact icon={<CreditCardFilled />} label={tx('বাকি আসল')} color="#f08c00" tint="#fdefd6">
              <strong>৳ {money(p.principal_after)}</strong>
            </Fact>
          </div>

          <div className="id-two">
            <Box icon={<UserOutlined />} title={tx('সদস্য ও ঋণ')}>
              <KV
                rows={[
                  [tx('সদস্যের নাম'), farmer ? <Link to={`/farmers/${farmer.id}`}>{nameOf(farmer)}</Link> : '—'],
                  [tx('সদস্য নং'), digits(p.loan.member?.member_no ?? '—')],
                  [tx('মোবাইল নং'), farmer?.mobile ? digits(farmer.mobile) : '—'],
                  [tx('ঋণ নং'), <Link to={`/loans/${p.loan.id}`}>{digits(p.loan.loan_no)}</Link>],
                  [tx('ঋণের ধরন'), nameOf(p.loan.product)],
                  [tx('ঋণের পরিমাণ'), `৳ ${money(p.loan.amount)}`],
                ]}
              />
            </Box>
            <Box icon={<BankFilled />} title={tx('জমার তথ্য')}>
              <KV
                rows={[
                  [tx('জরিমানা / সুদ / আসল'), `৳ ${money(p.penalty)} / ৳ ${money(p.interest)} / ৳ ${money(p.principal)}`],
                  [tx('মাধ্যম'), `${METHOD_LABEL[p.method] ?? p.method}${p.method !== 'cash' && p.fund ? ` — ${accountLabel(p.fund)}` : ''}`],
                  [tx('রেফারেন্স'), p.reference ? digits(p.reference) : '—'],
                  [
                    tx('ভাউচার'),
                    p.journal ? (
                      <>
                        {can('accounting.view') ? <Link to={`/accounting/journals/${p.journal.id}`}>{digits(p.journal.voucher_no)}</Link> : digits(p.journal.voucher_no)}
                        {p.journal.reversed_by && ` (${tx('রিভার্সাল')}: ${digits(p.journal.reversed_by.voucher_no)})`}
                      </>
                    ) : (
                      '—'
                    ),
                  ],
                  [tx('এন্ট্রি করেছেন'), `${nameOf(p.creator ?? null)} · ${fmtDateTime(p.created_at)}`],
                  [tx('মন্তব্য'), p.remarks || '—'],
                ]}
              />
            </Box>
          </div>
        </PageFrame>
      </div>

      <div className="print-only">
        <ReceiptPaper society={p.society} doc={{ type: "loan_payment", id: p.id }}>
          {p.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
          <div className="receipt-head">
            {p.society.logo && <img src={logoUrl()} alt="" className="receipt-logo" />}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="receipt-society">{nameOf(p.society)}</div>
              <Letterhead society={p.society} />
              {p.society.address && <div style={{ whiteSpace: 'pre-line' }}>{p.society.address}</div>}
              <div>
                {p.society.registration_no && tx('নিবন্ধন নং: {{p0}}', { p0: digits(p.society.registration_no) })}
                {p.society.registration_no && p.society.phone && ' · '}
                {p.society.phone && tx('ফোন: {{p0}}', { p0: digits(p.society.phone) })}
              </div>
              <div className="receipt-title">{tx('ঋণের কিস্তি জমার রশিদ')}</div>
            </div>
          </div>
  
          <table className="receipt-meta">
            <tbody>
              <tr>
                <td>
                  {tx('রশিদ নং')}: <strong>{digits(p.payment_no)}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {tx('তারিখ')}: <strong>{fmtDate(p.date)}</strong>
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  {tx('সদস্যের নাম')}: <strong>{nameOf(farmer)}</strong> ({tx('সদস্য নং')} {digits(p.loan.member?.member_no)}){farmer && `, ${tx('পিতা: {{p0}}', { p0: farmer.father_name })}`}
                  {farmer?.mobile && `, ${tx('মোবাইল')}: ${digits(farmer.mobile)}`}
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  {tx('ঋণ নং')}: <strong>{digits(p.loan.loan_no)}</strong> — {nameOf(p.loan.product)}, {tx('ঋণের পরিমাণ')} ৳{money(p.loan.amount)}
                </td>
              </tr>
            </tbody>
          </table>
  
          <table className="receipt-items">
            <thead>
              <tr>
                <th>{tx('বিবরণ')}</th>
                <th>{tx('টাকা')}</th>
              </tr>
            </thead>
            <tbody>
              {parts.map(([label, v]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{money(v)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>{tx('মোট জমা')}</strong>
                </td>
                <td className="num">
                  <strong>{money(amount)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
  
          <div style={{ margin: '8px 0' }}>
            {tx('কথায়')}: <strong>{amountInWords(amount)}</strong>
          </div>
          <div>
            {tx('এই জমার পর আসল বাকি')}: <strong>৳{money(p.principal_after)}</strong>
          </div>
          <div>
            {tx('মাধ্যম')}: {METHOD_LABEL[p.method] ?? p.method}
            {p.method !== 'cash' && p.fund && ` — ${accountLabel(p.fund)}`}
            {p.reference && `, ${tx('রেফারেন্স')}: ${digits(p.reference)}`}
          </div>
          {p.remarks && (
            <div>
              {tx('মন্তব্য')}: {p.remarks}
            </div>
          )}
  
          <ReceiptSign society={p.society} collector={nameOf(p.creator ?? null)} left={tx('সদস্যের স্বাক্ষর')} right={tx('দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর')} />
          <ReceiptFoot society={p.society} fallback={tx('কম্পিউটারে তৈরি রশিদ।')} />
        </ReceiptPaper>
      </div>

      <Modal open={cancelling} forceRender title={tx('পরিশোধ বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর জমাটি বাতিল হবে, ভাউচার রিভার্স হবে এবং কিস্তির হিসাব আগের অবস্থায় ফিরবে। শুধু সর্বশেষ জমা বাতিল করা যায়।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
