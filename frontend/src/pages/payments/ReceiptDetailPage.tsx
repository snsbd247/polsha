import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Spin, Table, Tag } from 'antd'
import { ArrowLeftOutlined, BankFilled, CalendarFilled, CreditCardFilled, DatabaseFilled, FileTextFilled, PrinterOutlined, StopOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_LABEL, amountInWords, type Owner } from '../../lib/irrigation'
import { type Society } from '../../lib/settings'
import { ReceiptPaper } from '../../components/PrintParts'
import { SlipHead, SlipLine, SlipRow, SlipSigns, slipTaka } from '../../components/PaperSlip'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { appUrl } from '../../lib/phase8'
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
    mouza_en?: string | null
    dag_no: string | null
    khatian_no: string | null
    area_decimal: number
    rate: number
    amount: number
    due_after: number
    owners: (Owner & { farmer_code?: string; is_member?: boolean })[]
    cultivation_type: string
    land_type: string | null
    lift?: string | null
    lift_en?: string | null
    is_current: boolean
    penalty: number
    patwari: { name: string; mobile: string | null } | null
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
    village: { name_bn: string; name_en: string | null } | null
  } | null
  farmer_is_member: boolean | null
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

  const verifyUrl = appUrl(`/verify/receipt/${r.verify_token}`)
  const amount = Number(r.amount)
  const showDue = r.society.show_due !== false
  const invoices = r.items.filter((it) => it.invoice)
  const dueAfter = invoices.reduce((s, it) => s + Number(it.invoice!.due_after), 0)

  // the paper receipt's lines, as the society's printed slip has them
  const others = r.items.filter((it) => !it.invoice)
  const uniq = (xs: string[]) => [...new Set(xs)].join(', ')
  const round4 = (v: number) => Math.round(v * 10000) / 10000
  const owners = [...new Map(invoices.flatMap((it) => it.invoice!.owners).map((o) => [o.id, o])).values()]
  const otherOwners = owners.filter((o) => o.id !== r.farmer?.id)

  // the society's paper slip: the owner and (for borga/lease) the tenant who paid; the current season's
  // charge up to area × rate, the bill's extra charges, earlier seasons' arrears and other items apart
  const slip = (() => {
    const cur = invoices.filter((it) => it.invoice!.is_current)
    const old = invoices.filter((it) => !it.invoice!.is_current)
    const tenancy = invoices.some((it) => it.invoice!.cultivation_type !== 'own')
    const payer = r.farmer ? nameOf(r.farmer) : r.payer_name
    const village = r.farmer?.village ? nameOf(r.farmer.village) : ''
    const base = (it: Item) => Math.max(0, Number(it.invoice!.amount) - Number(it.invoice!.penalty))
    const seasonPaid = cur.reduce((n, it) => n + Math.min(Number(it.amount), base(it)), 0)
    const area = [...new Map(cur.map((it) => [`${it.invoice!.mouza}|${it.invoice!.dag_no}`, Number(it.invoice!.area_decimal)])).values()].reduce((n, v) => n + v, 0)
    return {
      owner: tenancy ? otherOwners.map((o) => nameOf(o)).join(', ') : payer,
      ownerFather: tenancy ? (otherOwners[0]?.father_name ?? '') : (r.farmer?.father_name ?? ''),
      ownerVillage: tenancy ? '' : village,
      mouza: uniq(invoices.map((it) => (it.invoice!.mouza ? nameOf({ name_bn: it.invoice!.mouza, name_en: it.invoice!.mouza_en ?? null }) : '')).filter(Boolean)),
      borgadar: tenancy ? payer : '',
      borgadarFather: tenancy ? (r.farmer?.father_name ?? '') : '',
      borgadarVillage: tenancy ? village : '',
      season: uniq(cur.map((it) => it.invoice!.season ?? '').filter(Boolean)),
      area,
      rate: uniq(cur.map((it) => `${money(it.invoice!.rate)}${it.invoice!.lift ? ` (${nameOf({ name_bn: it.invoice!.lift, name_en: it.invoice!.lift_en ?? null })})` : ''}`)),
      seasonPaid,
      charges: cur.reduce((n, it) => n + Number(it.amount), 0) - seasonPaid,
      arrears: old.reduce((n, it) => n + Number(it.amount), 0),
      arrearSeasons: uniq(old.map((it) => it.invoice!.season ?? '').filter(Boolean)),
      misc: others.reduce((n, it) => n + Number(it.amount), 0),
    }
  })()

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
        <ReceiptPaper society={r.society} doc={{ type: 'receipt', id: r.id }} payerCopy={tx('কৃষক কপি')}>
          {r.status === 'cancelled' && <div className="receipt-stamp">{tx('বাতিলকৃত')}</div>}
          <SlipHead
            society={r.society}
            title={tx('সেচ চার্জ আদায় রশিদ')}
            qr={verifyUrl}
            serial={digits(r.is_legacy && r.legacy_no ? r.legacy_no : r.receipt_no)}
            date={fmtDate(r.date)}
          />
          <SlipRow>
            <SlipLine label={tx('জমির মালিকের নাম')} value={slip.owner} />
            <SlipLine label={tx('পিতা/স্বামী')} value={slip.ownerFather} />
          </SlipRow>
          <SlipRow>
            <SlipLine label={tx('মৌজা')} value={slip.mouza} />
            <SlipLine label={tx('গ্রাম')} value={slip.ownerVillage} />
          </SlipRow>
          <SlipRow>
            <SlipLine label={tx('বর্গাদারের নাম')} value={slip.borgadar} />
            <SlipLine label={tx('পিতা/স্বামী')} value={slip.borgadarFather} />
          </SlipRow>
          <SlipLine label={tx('গ্রাম/মহল্লা')} value={slip.borgadarVillage} />
          <table className="ps-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>{tx('নং')}</th>
                <th>{tx('বিবরণ')}</th>
                <th>{tx('জমির পরিমাণ')}</th>
                <th>{tx('হার')}</th>
                <th>{tx('টাকার পরিমাণ')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ps-c">{digits(1)}</td>
                <td>
                  {tx('ইরি/আমন/পারি')} <b>{slip.season}</b> {tx('মৌসুম')}
                </td>
                <td className="ps-c">{slip.area ? `${digits(round4(slip.area))} ${tx('শতক')}` : ''}</td>
                <td className="ps-c">{slip.rate}</td>
                <td className="ps-num">{slipTaka(slip.seasonPaid)}</td>
              </tr>
              <tr>
                <td className="ps-c">{digits(2)}</td>
                <td>{tx('ভর্তি ফি/নালা চার্জ')}</td>
                <td />
                <td />
                <td className="ps-num">{slipTaka(slip.charges)}</td>
              </tr>
              <tr>
                <td className="ps-c">{digits(3)}</td>
                <td>
                  {tx('বকেয়া আদায়')}
                  {slip.arrearSeasons && <small> ({slip.arrearSeasons})</small>}
                </td>
                <td />
                <td />
                <td className="ps-num">{slipTaka(slip.arrears)}</td>
              </tr>
              <tr>
                <td className="ps-c">{digits(4)}</td>
                <td>
                  {tx('বিবিধ')}
                  {others.length > 0 && <small> ({others.map((it) => it.description).join(', ')})</small>}
                </td>
                <td />
                <td />
                <td className="ps-num">{slipTaka(slip.misc)}</td>
              </tr>
            </tbody>
          </table>
          <div className="ps-sum">
            <SlipLine label={tx('কথায়')} value={`${amountInWords(amount)}`} />
            <table className="ps-totals">
              <tbody>
                <tr>
                  <th>{tx('মোট')} :</th>
                  <td>{slipTaka(amount + (showDue ? dueAfter : 0))}</td>
                </tr>
                <tr>
                  <th>{tx('আদায়')} :</th>
                  <td>{slipTaka(amount)}</td>
                </tr>
                <tr>
                  <th>{tx('বাকী')} :</th>
                  <td>{showDue ? slipTaka(dueAfter) || '০' : ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {r.method !== 'cash' && <SlipLine label={tx('মাধ্যম')} value={`${METHOD_LABEL[r.method] ?? r.method}${r.fund ? ` — ${accountLabel(r.fund)}` : ''}${r.reference ? `, ${tx('রেফারেন্স')}: ${digits(r.reference)}` : ''}`} />}
          <SlipSigns labels={[tx('সম্পাদকের স্বাক্ষর'), tx('আদায়কারীর স্বাক্ষর'), tx('হিসাবরক্ষকের স্বাক্ষর')]} />
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
