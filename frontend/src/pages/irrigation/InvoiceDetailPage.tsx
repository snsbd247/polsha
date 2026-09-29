import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Spin, Table, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarFilled, CheckCircleFilled, CreditCardFilled, DatabaseFilled, DollarOutlined, FileTextFilled, PrinterOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, useInvoiceMeta, type InvoiceRow } from '../../lib/irrigation'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres } from '../lands/ListFrame'
import { INVOICE_TONE } from './InvoiceListPage'
import './invoices.css'
import './invoice-detail.css'

type Payment = { id: number; receipt_no: string; date: string; status: string; method: string; is_legacy: boolean; legacy_no: string | null; amount: number }
type Detail = InvoiceRow & {
  overdue: boolean
  charges: { description: string; qty: number; rate: number; amount: number }[]
  discount: number
  remarks: string | null
  journal: { id: number; voucher_no: string; status: string } | null
  creator: { id: number; name_bn: string; name_en: string | null } | null
  rate_row: { id: number; rate: string; effective_from: string; approved_at: string | null } | null
  batch_id: number | null
  cancel_reason: string | null
  cancelled_at: string | null
  payments: Payment[]
  cancel_pending: boolean
  snapshot: { jl_no?: string | null; crop?: string | null; land_area?: number; cultivator?: { mobile?: string | null } }
}

function Fact({ icon, label, children, color, tint }: { icon: ReactNode; label: string; children: ReactNode; color: string; tint: string }) {
  return (
    <div className="id-fact">
      <span className="id-fact-icon" style={{ color, background: tint }}>
        {icon}
      </span>
      <span>
        <small>{label}</small>
        {children}
      </span>
    </div>
  )
}

function Box({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`id-box ${className ?? ''}`}>
      <header>
        {icon}
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  )
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="id-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <span>:</span>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One irrigation invoice: who, which plot, the charges, and its payments. */
export default function InvoiceDetailPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: meta } = useInvoiceMeta()
  const { data: inv, isLoading } = useQuery({ queryKey: ['invoices', id], queryFn: async () => (await api.get<Detail>(`/invoices/${id}`)).data })

  // opened with ?print=1 from the list: print once the invoice is on screen
  useEffect(() => {
    if (inv && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [inv, sp])
  if (isLoading || !inv) return <Spin />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/invoices/${inv.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const live = inv.payments.filter((p) => p.status !== 'cancelled')
  const last = live[live.length - 1]
  const canCancel = inv.status !== 'cancelled' && !inv.cancel_pending && inv.paid_amount <= 0
  const statusLabel = inv.overdue ? tx('মেয়াদোত্তীর্ণ') : (meta?.statuses[inv.status] ?? inv.status)
  const statusTone = inv.overdue ? 'fl-tag-red' : (INVOICE_TONE[inv.status] ?? 'll-gray')
  const irrigationCharge = Math.round(inv.area_decimal * inv.rate * 100) / 100
  const subtotal = irrigationCharge + inv.charges.reduce((s, c) => s + c.amount, 0)
  const lines = [{ description: tx('সেচ চার্জ'), qty: `${digits(inv.area_decimal)} ${tx('শতক')}`, rate: inv.rate, amount: irrigationCharge }, ...inv.charges.map((c) => ({ ...c, qty: digits(c.qty) }))]

  return (
    <PageFrame
      className="id-page"
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচ ইনভয়েসের তালিকা'), to: '/irrigation/invoices' }, { label: tx('ইনভয়েসের বিস্তারিত') }]}
      title={tx('সেচ ইনভয়েসের বিস্তারিত')}
      subtitle={tx('এই সেচ ইনভয়েসের বিস্তারিত তথ্য দেখুন।')}
      actions={
        <span className="no-print id-actions">
          <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
            {tx('ইনভয়েস প্রিন্ট')}
          </Button>
          {inv.due > 0 && inv.status !== 'cancelled' && (
            <Can perm="payment.create">
              <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate(`/payments/collect?farmer_id=${inv.farmer_id}`)}>
                {tx('টাকা আদায়')}
              </Button>
            </Can>
          )}
          {canCancel && (
            <Can perm="irrigation.edit">
              <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                {tx('বাতিল')}
              </Button>
            </Can>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/irrigation/invoices')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      {inv.status === 'cancelled' && <Alert type="error" showIcon className="id-alert" title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(inv.cancelled_at), p1: inv.cancel_reason ?? '' })} />}
      {inv.cancel_pending && <Alert type="warning" showIcon className="id-alert no-print" title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায়।')} />}

      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon">
            <FileTextFilled />
          </span>
          <div>
            <small>{tx('ইনভয়েস নং')}</small>
            <strong>{digits(inv.invoice_no)}</strong>
            <Tag className={`fl-tag ${statusTone}`}>● {statusLabel}</Tag>
          </div>
        </div>
        <Fact icon={<CalendarFilled />} label={tx('ইনভয়েসের তারিখ')} color="#1769e0" tint="#e4edfd">
          <strong>{fmtDate(inv.invoice_date)}</strong>
        </Fact>
        <Fact icon={<CalendarFilled />} label={tx('শেষ তারিখ')} color="#e5383b" tint="#fde4e5">
          <strong>{inv.due_date ? fmtDate(inv.due_date) : '—'}</strong>
        </Fact>
        <Fact icon={<DatabaseFilled />} label={tx('মোট টাকা')} color="#1769e0" tint="#e4edfd">
          <strong>৳ {money(inv.amount)}</strong>
        </Fact>
        <Fact icon={<CheckCircleFilled />} label={tx('পরিশোধের অবস্থা')} color={inv.status === 'paid' ? '#1f9d55' : inv.overdue ? '#e5383b' : '#f5a524'} tint={inv.status === 'paid' ? '#dcf3e5' : inv.overdue ? '#fde4e5' : '#fdefd6'}>
          <strong>{statusLabel}</strong>
          {last && <small>{tx('{{p0}} তারিখে আদায়', { p0: fmtDate(last.date) })}</small>}
        </Fact>
        <Fact icon={<CreditCardFilled />} label={tx('পরিশোধের মাধ্যম')} color="#1769e0" tint="#e4edfd">
          <strong>{last ? (METHOD_LABEL[last.method] ?? last.method) : '—'}</strong>
          {last && <small>{tx('রশিদ: {{p0}}', { p0: digits(last.receipt_no) })}</small>}
        </Fact>
      </div>

      <div className="id-two">
        <Box icon={<UserOutlined />} title={tx('কৃষকের তথ্য')}>
          <KV
            rows={[
              [tx('কৃষক আইডি'), inv.cultivator ? digits(inv.cultivator.farmer_code) : '—'],
              [tx('কৃষকের নাম'), inv.cultivator ? <Link to={`/farmers/${inv.cultivator.id}`}>{nameOf(inv.cultivator)}</Link> : '—'],
              [tx('পিতার নাম'), inv.cultivator?.father_name],
              [tx('মোবাইল নং'), inv.snapshot.cultivator?.mobile ? digits(inv.snapshot.cultivator.mobile) : '—'],
              [tx('মৌজা'), nameOf({ name_bn: inv.mouza, name_en: inv.mouza_en })],
            ]}
          />
        </Box>
        <Box icon={<DashIcon name="sprout" size={20} color="#1769e0" stroke={2.2} />} title={tx('জমির তথ্য')}>
          <KV
            rows={[
              [tx('জমি / দাগ নং'), <Link to={`/lands/${inv.land_id}`}>{`${inv.land_code} · ${tx('দাগ')} ${digits(inv.dag_no ?? '')}`}</Link>],
              [tx('পরিমাণ (একর)'), acres(inv.snapshot.land_area ?? inv.area_decimal)],
              [tx('জমির ধরন'), inv.land_type],
              [tx('মালিক'), inv.owners.map((o) => nameOf(o) + (o.share_percent < 100 ? ` (${digits(o.share_percent)}%)` : '')).join(', ') || '—'],
              [tx('চাষের ধরন'), meta?.cultivation_types[inv.cultivation_type] ?? inv.cultivation_type],
              [tx('মৌসুম'), inv.season],
            ]}
          />
        </Box>
      </div>

      <Box icon={<DashIcon name="drop" size={20} color="#1769e0" stroke={2.2} />} title={tx('সেচের বিবরণ')}>
        <div className="id-grid3">
          <KV rows={[[tx('সেচের উৎস'), inv.irrigation_type], [tx('সেচের জমি'), `${digits(inv.area_decimal)} ${tx('শতক')}`]]} />
          <KV rows={[[tx('সেচের তারিখ'), fmtDate(inv.invoice_date)], [tx('রেট (৳/শতক)'), money(inv.rate)]]} />
          <KV
            rows={[
              [tx('রেট কার্যকর'), inv.rate_row ? fmtDate(inv.rate_row.effective_from) : '—'],
              [tx('ভাউচার'), inv.journal ? (can('accounting.view') ? <Link to={`/accounting/journals/${inv.journal.id}`}>{digits(inv.journal.voucher_no)}</Link> : digits(inv.journal.voucher_no)) : '—'],
            ]}
          />
        </div>
      </Box>

      <div className="id-charges-row">
        <Box icon={<FileTextFilled />} title={tx('চার্জের বিবরণ')} className="id-charges">
          <table className="iv-charges">
            <thead>
              <tr>
                <th>#</th>
                <th>{tx('বিবরণ')}</th>
                <th>{tx('পরিমাণ')}</th>
                <th>{tx('রেট (৳)')}</th>
                <th>{tx('টাকা (৳)')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{digits(i + 1)}</td>
                  <td>{l.description}</td>
                  <td>{l.qty}</td>
                  <td>{money(l.rate)}</td>
                  <td>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        <div className="iv-totals id-totals">
          <div>
            <span>{tx('উপমোট')}</span>
            <span>৳ {money(subtotal)}</span>
          </div>
          <div>
            <span>{tx('ছাড় (-)')}</span>
            <span>৳ {money(inv.discount)}</span>
          </div>
          <div className="iv-grand">
            <span>{tx('মোট টাকা')}</span>
            <span>৳ {money(inv.amount)}</span>
          </div>
          <div>
            <span>{tx('আদায় (-)')}</span>
            <span>৳ {money(inv.paid_amount)}</span>
          </div>
          <div className="id-due">
            <span>{tx('বকেয়া')}</span>
            <span>৳ {money(inv.due)}</span>
          </div>
        </div>
      </div>

      <Box icon={<CheckCircleFilled style={{ color: '#1f9d55' }} />} title={tx('পরিশোধের তথ্য')}>
        <Table<Payment>
          rowKey="id"
          size="small"
          className="id-payments"
          pagination={false}
          dataSource={inv.payments}
          locale={{ emptyText: tx('এখনো কোনো আদায় হয়নি') }}
          columns={[
            { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, p) => <Link to={`/payments/receipts/${p.id}`}>{digits(v)}</Link> },
            { title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', render: (v) => (v ? digits(v) : '—') },
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => METHOD_LABEL[v] ?? v },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag color={RECEIPT_STATUS_COLOR[v]}>{RECEIPT_STATUS_LABEL[v] ?? v}</Tag> },
          ]}
        />
        <div className="id-foot">
          <KV rows={[[tx('প্রস্তুতকারী'), nameOf(inv.creator) || '—'], [tx('মন্তব্য'), inv.remarks || '—']]} />
          {inv.batch_id && (
            <Link to={`/irrigation/invoices?batch_id=${inv.batch_id}`} className="no-print">
              {tx('একই ব্যাচের ইনভয়েস')} #{digits(inv.batch_id)}
            </Link>
          )}
        </div>
      </Box>

      <Modal open={cancelling} forceRender title={tx('ইনভয়েস বাতিল')} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('অনুমোদনের পর ইনভয়েস বাতিল হবে এবং এর হিসাব (পাওনা/আয়) রিভার্স হবে।')} />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
