import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Spin, Table, Tabs, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  BankFilled,
  CalendarFilled,
  CheckCircleFilled,
  DatabaseFilled,
  DollarOutlined,
  DownloadOutlined,
  FileTextFilled,
  PercentageOutlined,
  PrinterOutlined,
  SendOutlined,
  StopOutlined,
  TeamOutlined,
  UserOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import type { Person } from '../../lib/funds'
import { METHOD_LABEL } from '../../lib/irrigation'
import { penaltyText, termsText, useLoanMeta, type Installment, type LoanPayment, type LoanRow, type Position, type ScheduleRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { LOAN_TONE } from './LoanListPage'
import { DisburseModal, PayModal } from './LoanMoneyModals'
import SchedulePreview from './SchedulePreview'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../savings/savings.css'
import './loans.css'

type Guarantor = { id: number; member_id: number; relation: string | null; member: LoanRow['member'] }
type Detail = LoanRow & {
  remarks: string | null
  method: string | null
  reference: string | null
  guarantors: Guarantor[]
  fund: { code: string; name_bn: string; name_en: string | null } | null
  journal: { id: number; voucher_no: string; status: string } | null
  creator: Person
  disburser: Person
  created_at: string
  position: Position | null
  preview: ScheduleRow[] | null
  payments: LoanPayment[]
  approval: { id: number; status: string; current_step: number; total_steps: number } | null
}

const STATE_TONE: Record<string, string> = { paid: 'fl-tag-green', overdue: 'fl-tag-red', partial: 'fl-tag-gold', due: 'll-gray' }
const PAYMENT_TONE: Record<string, string> = { posted: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

/** One loan: the member and guarantors, the terms, what is owed now, and its schedule, statement and receipts. */
export default function LoanDetailPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useLoanMeta()
  const [modal, setModal] = useState<'disburse' | 'pay' | 'cancel' | null>(null)
  const [form] = Form.useForm()

  const { data: l, isLoading } = useQuery({ queryKey: ['loan', id], queryFn: async () => (await api.get<Detail>(`/loans/${id}`)).data })
  const disbursed = !!l?.disbursed_on
  if (isLoading || !l) return <Spin />

  const refresh = () => {
    setModal(null)
    queryClient.invalidateQueries({ queryKey: ['loan', id] })
    queryClient.invalidateQueries({ queryKey: ['loans'] })
  }
  const cancel = async () => {
    const v = await form.validateFields()
    try {
      const res = await api.post<{ message: string }>(`/loans/${l.id}/cancel`, v)
      message.success(res.data.message)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const p = l.position
  const canCollect = can(['loan.create', 'payment.create'])
  const pendingCancel = l.payments.some((x) => x.status === 'cancel_pending')
  const farmer = l.member?.farmer
  const statusLabel = meta.data?.statuses[l.status] ?? l.status
  const terms = termsText(l, meta.data?.frequencies)
  const late = !!p?.overdue_amount

  return (
    <PageFrame
      className="id-page ln-page"
      crumbs={[{ label: tx('ঋণ'), to: '/loans' }, { label: tx('ঋণের তালিকা'), to: '/loans' }, { label: tx('ঋণের বিস্তারিত') }]}
      title={tx('ঋণের বিস্তারিত')}
      actions={
        <span className="no-print id-actions">
          {disbursed && (
            <>
              <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
                {tx('প্রিন্ট')}
              </Button>
              <Button icon={<DownloadOutlined />} className="fm-history-btn" onClick={() => downloadExport(`/loans/${l.id}/statement`, { export: 'csv' }, `loan-statement-${l.loan_no}.csv`).catch((e) => message.error(errorMessage(e)))}>
                Excel
              </Button>
            </>
          )}
          {l.status === 'approved' && can('loan.create') && (
            <>
              <Button type="primary" icon={<SendOutlined />} onClick={() => setModal('disburse')}>
                {tx('বিতরণ করুন')}
              </Button>
              <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setModal('cancel'))}>
                {tx('আবেদন বাতিল')}
              </Button>
            </>
          )}
          {l.status === 'active' && canCollect && (
            <Button type="primary" icon={<DollarOutlined />} disabled={pendingCancel} onClick={() => setModal('pay')}>
              {tx('কিস্তি জমা')}
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/loans')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      {l.status === 'pending' && (
        <Alert
          className="id-alert no-print"
          type="warning"
          showIcon
          title={
            <>
              {tx('আবেদনটি অনুমোদনের অপেক্ষায়।')} {l.approval && <Link to={`/approvals/${l.approval.id}`}>{tx('অনুমোদনের অনুরোধ দেখুন')}</Link>}
            </>
          }
        />
      )}
      {l.status === 'approved' && <Alert className="id-alert no-print" type="info" showIcon title={tx('অনুমোদিত — টাকা বিতরণ করলে কিস্তির তালিকা চালু হবে।')} />}
      {pendingCancel && <Alert className="id-alert no-print" type="warning" showIcon title={tx('একটি পরিশোধ বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় — নিষ্পত্তির আগে নতুন কিস্তি নেওয়া যাবে না।')} />}

      <div className="print-only" style={{ textAlign: 'center', marginBottom: 12 }}>
        <span className="receipt-title">{tx('ঋণ বিবরণী — {{p0}}', { p0: digits(l.loan_no) })}</span>
      </div>

      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon">
            <FileTextFilled />
          </span>
          <div>
            <small>{tx('ঋণ নং')}</small>
            <strong>{digits(l.loan_no)}</strong>
            <Tag className={`fl-tag ${LOAN_TONE[l.status] ?? 'll-gray'}`}>● {statusLabel}</Tag>
            {p?.bucket && <Tag className="fl-tag fl-tag-red">{meta.data?.buckets[p.bucket]}</Tag>}
          </div>
        </div>
        <Fact icon={<DatabaseFilled />} label={tx('ঋণের পরিমাণ')} color="#1769e0" tint="#e4edfd">
          <strong>৳ {money(l.amount)}</strong>
          <small>{nameOf(l.product)}</small>
        </Fact>
        {p ? (
          <>
            <Fact icon={<BankFilled />} label={tx('আসল বাকি')} color="#8b3fe0" tint="#efe4fc">
              <strong>৳ {money(p.principal_outstanding)}</strong>
            </Fact>
            <Fact icon={<PercentageOutlined />} label={tx('সুদ বাকি')} color="#0e9f9a" tint="#d9f4f2">
              <strong>৳ {money(p.interest_outstanding)}</strong>
            </Fact>
            <Fact icon={late ? <WarningFilled /> : <CheckCircleFilled />} label={tx('এখন দেয় (জরিমানাসহ)')} color={late ? '#e5383b' : '#1f9d55'} tint={late ? '#fde4e5' : '#dcf3e5'}>
              <strong>৳ {money(p.due_now)}</strong>
              {p.oldest_overdue && <small>{tx('{{p0}} দিন মেয়াদোত্তীর্ণ', { p0: digits(p.days_overdue) })}</small>}
            </Fact>
          </>
        ) : (
          <>
            <Fact icon={<CalendarFilled />} label={tx('আবেদনের তারিখ')} color="#1769e0" tint="#e4edfd">
              <strong>{fmtDate(l.applied_on)}</strong>
            </Fact>
            <Fact icon={<PercentageOutlined />} label={tx('সুদ')} color="#0e9f9a" tint="#d9f4f2">
              <strong>{digits(Number(l.interest_rate))}%</strong>
              <small>{meta.data?.methods[l.interest_method] ?? l.interest_method}</small>
            </Fact>
            <Fact icon={<CalendarFilled />} label={tx('কিস্তি')} color="#f08c00" tint="#fdefd6">
              <strong>{terms}</strong>
            </Fact>
          </>
        )}
      </div>

      <Box icon={<FileTextFilled />} title={tx('ঋণের সব তথ্য')} className="ln-tabs-box">
        <Tabs
          className="ln-tabs"
          defaultActiveKey={search.get('tab') ?? 'summary'}
          items={[
            {
              key: 'summary',
              label: tx('সারসংক্ষেপ'),
              children: (
                <>
                  <div className="id-two">
                    <Box icon={<UserOutlined />} title={tx('সদস্যের তথ্য')}>
                      <KV
                        rows={[
                          [tx('সদস্যের নাম'), farmer ? <Link to={`/farmers/${farmer.id}`}>{nameOf(farmer)}</Link> : '—'],
                          [tx('সদস্য নং'), digits(l.member?.member_no ?? '—')],
                          [tx('পিতার নাম'), farmer?.father_name],
                          [tx('মোবাইল নং'), farmer?.mobile ? digits(farmer.mobile) : '—'],
                          [tx('জামিনদার'), l.guarantors.length ? l.guarantors.map((g) => nameOf(g.member?.farmer)).join(', ') : '—'],
                        ]}
                      />
                    </Box>
                    <Box icon={<FileTextFilled />} title={tx('ঋণের শর্ত')}>
                      <KV
                        rows={[
                          [tx('ঋণের প্ল্যান'), nameOf(l.product)],
                          [tx('সুদ'), `${digits(Number(l.interest_rate))}% ${tx('বার্ষিক')}${l.interest_method !== 'flat' ? ` · ${meta.data?.methods[l.interest_method] ?? l.interest_method}` : ''}`],
                          [tx('কিস্তি'), terms],
                          [tx('দেরিতে জরিমানা'), penaltyText(l)],
                          [tx('ঋণসীমা'), `৳ ${money(l.limit_amount)}`],
                          [tx('আবেদন'), `${fmtDate(l.applied_on)} · ${nameOf(l.creator)}`],
                          ...((disbursed
                            ? [
                                [tx('বিতরণ'), `${fmtDate(l.disbursed_on)} · ${METHOD_LABEL[l.method ?? ''] ?? l.method ?? ''}${l.fund ? ` — ${accountLabel(l.fund)}` : ''}${l.reference ? `, ${digits(l.reference)}` : ''}`],
                                [tx('মোট সুদ'), `৳ ${money(l.total_interest)}`],
                                [tx('ভাউচার'), l.journal ? can('accounting.view') ? <Link to={`/accounting/journals/${l.journal.id}`}>{digits(l.journal.voucher_no)}</Link> : digits(l.journal.voucher_no) : '—'],
                              ]
                            : []) as [string, React.ReactNode][]),
                          ...((l.closed_on ? [[tx('সমাপ্তির তারিখ'), fmtDate(l.closed_on)]] : []) as [string, React.ReactNode][]),
                          ...((l.purpose ? [[tx('উদ্দেশ্য'), l.purpose]] : []) as [string, React.ReactNode][]),
                          ...((l.remarks ? [[tx('মন্তব্য'), l.remarks]] : []) as [string, React.ReactNode][]),
                        ]}
                      />
                    </Box>
                  </div>
                  {p && (
                    <div className="ln-paid-line">
                      {tx('আদায় হয়েছে')}: {tx('আসল ৳{{p0}}, সুদ ৳{{p1}}, জরিমানা ৳{{p2}}', { p0: money(p.principal_paid), p1: money(p.interest_paid), p2: money(p.penalty_paid) })}
                      {` · ${tx('পুরো ঋণ শোধে')}: ৳${money(p.payoff)} (${tx('জরিমানা ৳{{p0}}', { p0: money(p.penalty_due) })})`}
                      {p.oldest_overdue && ` · ${tx('সবচেয়ে পুরনো বকেয়া')}: ${fmtDate(p.oldest_overdue)}`}
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'schedule',
              label: disbursed ? tx('কিস্তিসূচি') : tx('কিস্তিসূচি (সম্ভাব্য)'),
              children: !disbursed ? (
                <div className="id-payments">
                  <SchedulePreview rows={l.preview ?? []} />
                </div>
              ) : (
                <Table<Installment>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={p?.installments}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    { title: tx('কিস্তি'), dataIndex: 'seq', render: (v: number) => digits(v) },
                    { title: tx('তারিখ'), dataIndex: 'due_date', render: fmtDate },
                    { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
                    { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
                    { title: tx('কিস্তি (মোট)'), dataIndex: 'total', align: 'right', render: money },
                    { title: tx('জমা হয়েছে'), align: 'right', render: (_, r) => moneyOrBlank(Number(r.principal_paid) + Number(r.interest_paid)) },
                    { title: tx('বাকি'), dataIndex: 'outstanding', align: 'right', render: (v: number) => <strong>{moneyOrBlank(v)}</strong> },
                    { title: tx('জরিমানা'), align: 'right', render: (_, r) => moneyOrBlank(Number(r.penalty_paid) + r.penalty_due) },
                    {
                      title: tx('অবস্থা'),
                      dataIndex: 'state',
                      render: (s: string, r) => (
                        <Tag className={`fl-tag ${STATE_TONE[s] ?? 'll-gray'}`}>
                          {STATE_LABEL[s]}
                          {r.paid_on && s === 'paid' ? ` ${fmtDate(r.paid_on)}` : ''}
                        </Tag>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'payments',
              label: tx('পরিশোধের ইতিহাস ({{p0}})', { p0: digits(l.payments.length) }),
              children: (
                <Table<LoanPayment>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={l.payments}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: disbursed ? tx('এখনো কোনো কিস্তি জমা হয়নি') : tx('বিতরণের পর কিস্তি জমা নেওয়া যাবে') }}
                  columns={[
                    { title: tx('রশিদ নং'), dataIndex: 'payment_no', render: (v: string, r) => <Link to={`/loans/payments/${r.id}`}>{digits(v)}</Link> },
                    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                    { title: tx('মোট জমা'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
                    { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
                    { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
                    { title: tx('জরিমানা'), dataIndex: 'penalty', align: 'right', render: (v: string) => moneyOrBlank(Number(v)) },
                    { title: tx('আসল বাকি'), dataIndex: 'principal_after', align: 'right', render: money },
                    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag className={`fl-tag ${PAYMENT_TONE[s] ?? 'll-gray'}`}>{meta.data?.payment_statuses[s] ?? s}</Tag> },
                    { title: tx('এন্ট্রির সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
                  ]}
                />
              ),
            },
            {
              key: 'guarantors',
              label: tx('জামিনদার ({{p0}})', { p0: digits(l.guarantors.length) }),
              children: (
                <Table<Guarantor>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={l.guarantors}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: tx('কোনো জামিনদার নেই') }}
                  columns={[
                    { title: '#', width: 44, render: (_, __, i) => digits(i + 1) },
                    {
                      title: tx('জামিনদার'),
                      render: (_, g) =>
                        g.member?.farmer ? (
                          <Link to={`/farmers/${g.member.farmer.id}`}>
                            <TeamOutlined /> {nameOf(g.member.farmer)}
                          </Link>
                        ) : (
                          '—'
                        ),
                    },
                    { title: tx('সদস্য নং'), render: (_, g) => digits(g.member?.member_no ?? '—') },
                    { title: tx('মোবাইল'), render: (_, g) => digits(g.member?.farmer?.mobile ?? '—') },
                    { title: tx('সম্পর্ক'), dataIndex: 'relation', render: (v: string | null) => v || '—' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Box>

      <DisburseModal loan={l} open={modal === 'disburse'} onClose={() => setModal(null)} onDone={refresh} />
      <PayModal
        loan={l}
        open={modal === 'pay'}
        onClose={() => setModal(null)}
        onDone={(pid) => {
          refresh()
          navigate(`/loans/payments/${pid}`)
        }}
      />
      <Modal open={modal === 'cancel'} forceRender title={tx('ঋণ আবেদন বাতিল')} onCancel={() => setModal(null)} onOk={cancel} okText={tx('বাতিল করুন')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}

const STATE_LABEL: Record<string, string> = { paid: tx('পরিশোধিত'), overdue: tx('মেয়াদোত্তীর্ণ'), partial: tx('আংশিক'), due: tx('বাকি') }
