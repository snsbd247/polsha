import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, QRCode, Spin, Table, Tag } from 'antd'
import { ArrowLeftOutlined, BankFilled, CalendarFilled, CreditCardFilled, DatabaseFilled, FileTextFilled, PrinterOutlined, StopOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_LABEL, amountInWords, type Owner } from '../../lib/irrigation'
import { logoUrl, type Society } from '../../lib/settings'
import { Letterhead, ReceiptFoot, ReceiptPaper, ReceiptSign } from '../../components/PrintParts'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { RECEIPT_TONE } from './ReceiptListPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'

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
  farmer: {
    id: number
    farmer_code: string
    name_bn: string
    name_en: string | null
    father_name: string
    mobile: string | null
  } | null
  fund: {
    id: number
    code: string
    name_bn: string
    name_en: string | null
  } | null
  journal: {
    id: number
    voucher_no: string
    status: string
    reversed_by: { id: number; voucher_no: string } | null
  } | null
  creator: User
  canceller: User
  society: Society
}

/** An irrigation receipt: the details on screen, the paper receipt (with its QR check) only on print. */
export default function ReceiptDetailPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()

  const { data: r, isLoading } = useQuery({
    queryKey: ['receipts', id],
    queryFn: async () => (await api.get<Detail>(`/receipts/${id}`)).data,
  })
  // opened with ?print=1 from the list: print once the receipt is on screen
  useEffect(() => {
    if (r && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [r, sp])
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
  const invoices = r.items.filter((it) => it.invoice)
  const dueAfter = invoices.reduce((s, it) => s + Number(it.invoice!.due_after), 0)

  return (
    <>
      <div className="no-print">
        <PageFrame
          className="id-page ln-page ln-receipt"
          crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('রশিদ তালিকা'), to: '/payments/receipts' }, { label: tx('রশিদের বিস্তারিত') }]}
          title={tx('রশিদের বিস্তারিত')}
          actions={
            <span className="id-actions">
              <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
                {tx('রশিদ প্রিন্ট')}
              </Button>
              {r.status === 'active' && can('payment.create') && (
                <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                  {tx('রশিদ বাতিল')}
                </Button>
              )}
              <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/payments/receipts')}>
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
              title={tx('বাতিল হয়েছে {{p0}} ({{p1}}) — কারণ: {{p2}}', {
                p0: fmtDateTime(r.cancelled_at),
                p1: nameOf(r.canceller),
                p2: r.cancel_reason ?? '',
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
                <strong>{digits(r.receipt_no)}</strong>
                <Tag className={`fl-tag ${RECEIPT_TONE[r.status] ?? 'll-gray'}`}>● {RECEIPT_STATUS_LABEL[r.status] ?? r.status}</Tag>
              </div>
            </div>
            <Fact icon={<CalendarFilled />} label={tx('তারিখ')} color="#1769e0" tint="#e4edfd">
              <strong>{fmtDate(r.date)}</strong>
            </Fact>
            <Fact icon={<DatabaseFilled />} label={tx('মোট জমা')} color="#1f9d55" tint="#dcf3e5">
              <strong>৳ {money(amount)}</strong>
            </Fact>
            <Fact icon={<UnorderedListOutlined />} label={tx('ইনভয়েস')} color="#8b3fe0" tint="#efe4fc">
              <strong>{digits(invoices.length)}</strong>
            </Fact>
            <Fact icon={<CreditCardFilled />} label={tx('অবশিষ্ট বকেয়া')} color="#f08c00" tint="#fdefd6">
              <strong>৳ {money(dueAfter)}</strong>
            </Fact>
          </div>

          <div className="id-two">
            <Box icon={<UserOutlined />} title={tx('প্রদানকারী')}>
              <KV
                rows={[
                  [tx('নাম'), r.farmer ? <Link to={`/farmers/${r.farmer.id}`}>{nameOf(r.farmer)}</Link> : r.payer_name],
                  [tx('কৃষক আইডি'), r.farmer ? digits(r.farmer.farmer_code) : '—'],
                  [tx('পিতার নাম'), r.farmer?.father_name || '—'],
                  [tx('মোবাইল নং'), r.farmer?.mobile ? digits(r.farmer.mobile) : '—'],
                  [tx('পুরনো রশিদ নং'), r.is_legacy && r.legacy_no ? digits(r.legacy_no) : '—'],
                ]}
              />
            </Box>
            <Box icon={<BankFilled />} title={tx('জমার তথ্য')}>
              <KV
                rows={[
                  [tx('মাধ্যম'), `${METHOD_LABEL[r.method] ?? r.method}${r.method !== 'cash' && r.fund ? ` — ${accountLabel(r.fund)}` : ''}`],
                  [tx('রেফারেন্স'), r.reference ? digits(r.reference) : '—'],
                  [
                    tx('ভাউচার'),
                    r.journal ? (
                      <>
                        {can('accounting.view') ? <Link to={`/accounting/journals/${r.journal.id}`}>{digits(r.journal.voucher_no)}</Link> : digits(r.journal.voucher_no)}
                        {r.journal.reversed_by && ` (${tx('রিভার্সাল')}: ${digits(r.journal.reversed_by.voucher_no)})`}
                      </>
                    ) : (
                      '—'
                    ),
                  ],
                  [tx('এন্ট্রি করেছেন'), `${nameOf(r.creator)} · ${fmtDateTime(r.created_at)}`],
                  [tx('মন্তব্য'), r.remarks || '—'],
                ]}
              />
            </Box>
          </div>

          <Box icon={<UnorderedListOutlined />} title={tx('জমার বিবরণ')}>
            <Table<Item>
              rowKey="id"
              size="small"
              className="id-payments"
              dataSource={r.items}
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={[
                {
                  title: '#',
                  width: 44,
                  align: 'center',
                  render: (_, __, i) => digits(i + 1),
                },
                {
                  title: tx('ইনভয়েস'),
                  render: (_, it) => (it.invoice ? <Link to={`/irrigation/invoices/${it.invoice.id}`}>{digits(it.invoice.invoice_no)}</Link> : it.description),
                },
                {
                  title: tx('মৌসুম'),
                  render: (_, it) => it.invoice?.season ?? '—',
                },
                {
                  title: tx('মৌজা / দাগ'),
                  render: (_, it) => (it.invoice ? `${it.invoice.mouza ?? '—'} / ${digits(it.invoice.dag_no ?? '—')}` : '—'),
                },
                {
                  title: tx('জমি (শতক)'),
                  align: 'right',
                  render: (_, it) => (it.invoice ? digits(it.invoice.area_decimal) : ''),
                },
                {
                  title: tx('বিল (৳)'),
                  align: 'right',
                  render: (_, it) => (it.invoice ? money(it.invoice.amount) : ''),
                },
                {
                  title: tx('জমা (৳)'),
                  align: 'right',
                  render: (_, it) => <strong>{money(it.amount)}</strong>,
                },
                {
                  title: tx('অবশিষ্ট বকেয়া (৳)'),
                  align: 'right',
                  render: (_, it) => (it.invoice ? money(it.invoice.due_after) : ''),
                },
              ]}
            />
          </Box>
        </PageFrame>
      </div>

      <div className="print-only">
        <ReceiptPaper society={r.society} doc={{ type: 'receipt', id: r.id }}>
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
              <div className="receipt-title">{tx('টাকার রশিদ — সেচ চার্জ')}</div>
            </div>
            {r.society.show_qr !== false && <QRCode value={verifyUrl} size={96} bordered={false} />}
          </div>

          <table className="receipt-meta">
            <tbody>
              <tr>
                <td>
                  {tx('রশিদ নং')}: <strong>{digits(r.receipt_no)}</strong>
                  {r.is_legacy && r.legacy_no && (
                    <>
                      {' '}
                      ({tx('পুরনো রশিদ নং')}: {digits(r.legacy_no)})
                    </>
                  )}
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
      </div>

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
