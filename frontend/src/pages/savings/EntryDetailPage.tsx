import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Spin, Table, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  BankFilled,
  CalendarFilled,
  CheckCircleFilled,
  ClockCircleFilled,
  CreditCardFilled,
  DatabaseFilled,
  FileTextFilled,
  HistoryOutlined,
  PlusOutlined,
  PrinterOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import FundReceipt, { type FundTxnDetail } from '../../components/FundReceipt'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { useFundMeta } from '../../lib/funds'
import { ENTRY, EVENT_TONE, TXN_TONE, type EntryKey } from '../../lib/fundEntry'
import { METHOD_LABEL } from '../../lib/irrigation'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../lands/land-history.css'
import DecideButtons from './DecideButtons'
import './savings.css'

/** One share payment or withdrawal: who, how much, how it was paid, its voucher, its history, and the printable slip. */
export default function EntryDetailPage({ entry }: { entry: EntryKey }) {
  const { id = '' } = useParams()
  const cfg = ENTRY[entry]
  const [sp] = useSearchParams()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [form] = Form.useForm()
  const { data: meta } = useFundMeta(cfg.kind)
  const { data: t, isLoading, isError, error } = useQuery({ queryKey: ['fund-txn', cfg.kind, id], queryFn: async () => (await api.get<FundTxnDetail>(`/funds/${cfg.kind}/transactions/${id}`)).data })

  // opened with ?print=1 (after saving, or from the list): print once the slip is on screen
  useEffect(() => {
    if (t && sp.get('print') === '1') setTimeout(() => window.print(), 400)
  }, [t, sp])
  useEffect(() => {
    if (t && hash === '#history') document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' })
  }, [t, hash])
  if (isError) return <Alert type="error" showIcon title={errorMessage(error)} />
  if (isLoading || !t) return <Spin />
  if (t.type !== cfg.type) return <Alert type="warning" showIcon title={tx('এটি {{p0}} নয়।', { p0: cfg.noun })} action={<Link to={`/funds/${cfg.kind}/transactions/${t.id}`}>{tx('লেনদেন দেখুন')}</Link>} />

  const cancel = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/funds/${cfg.kind}/transactions/${t.id}/cancel`, v)
      message.success(tx('বাতিলের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setCancelling(false)
      queryClient.invalidateQueries({ queryKey: ['fund-txn', cfg.kind] })
      queryClient.invalidateQueries({ queryKey: ['fund-entries'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const farmer = t.account.member?.farmer
  const statusLabel = meta?.statuses[t.status] ?? t.status
  const tone = TXN_TONE[t.status] ?? 'll-gray'
  const green = t.status === 'posted'

  return (
    <>
      <div className="no-print">
        <PageFrame
          className="id-page"
          crumbs={[{ label: tx('সঞ্চয়'), to: cfg.base }, { label: cfg.list, to: cfg.base }, { label: cfg.detail }]}
          title={cfg.detail}
          actions={
            <span className="id-actions">
              <Button icon={<PrinterOutlined />} className="fm-history-btn" onClick={() => window.print()}>
                {tx('রশিদ প্রিন্ট')}
              </Button>
              {can(`${cfg.kind}.create`) && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`${cfg.base}/new`)}>
                  {cfg.add}
                </Button>
              )}
              {cfg.out && t.status === 'pending' && t.approval_request_id && can(`${cfg.kind}.approve`) && t.creator?.id !== user?.id && (
                <DecideButtons
                  approvalId={t.approval_request_id}
                  amount={t.amount}
                  who={nameOf(farmer)}
                  onDone={() => {
                    queryClient.invalidateQueries({ queryKey: ['fund-txn', cfg.kind] })
                    queryClient.invalidateQueries({ queryKey: ['fund-entries'] })
                  }}
                />
              )}
              {t.can_cancel && can(`${cfg.kind}.create`) && (
                <Button danger icon={<StopOutlined />} onClick={() => (form.resetFields(), setCancelling(true))}>
                  {tx('বাতিল')}
                </Button>
              )}
              <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(cfg.base)}>
                {tx('তালিকায় ফিরুন')}
              </Button>
            </span>
          }
        >
          {t.status === 'pending' && <Alert type="warning" showIcon className="id-alert" title={cfg.out ? tx('এই উত্তোলন অনুমোদনের অপেক্ষায় — অনুমোদনের পর হিসাব থেকে কাটা হবে।') : tx('এই লেনদেন অনুমোদনের অপেক্ষায় — অনুমোদনের পর হিসাবে যোগ হবে।')} />}
          {t.status === 'cancel_pending' && <Alert type="warning" showIcon className="id-alert" title={tx('বাতিলের আবেদন অনুমোদনের অপেক্ষায় — কারণ: {{p0}}', { p0: t.cancel_reason ?? '' })} />}
          {t.status === 'cancelled' && <Alert type="error" showIcon className="id-alert" title={tx('বাতিল হয়েছে {{p0}} — কারণ: {{p1}}', { p0: fmtDateTime(t.cancelled_at), p1: t.cancel_reason ?? '' })} />}

          <div className="id-top">
            <div className="id-hero">
              <span className="id-hero-icon">
                <FileTextFilled />
              </span>
              <div>
                <small>{cfg.no}</small>
                <strong>{digits(t.txn_no)}</strong>
                <Tag className={`fl-tag ${tone}`}>● {statusLabel}</Tag>
              </div>
            </div>
            <Fact icon={<CalendarFilled />} label={tx('তারিখ')} color="#1769e0" tint="#e4edfd">
              <strong>{fmtDate(t.date)}</strong>
            </Fact>
            <Fact icon={<DatabaseFilled />} label={tx('টাকার পরিমাণ')} color="#1f9d55" tint="#dcf3e5">
              <strong>৳ {money(t.amount)}</strong>
            </Fact>
            <Fact icon={<CreditCardFilled />} label={tx('মাধ্যম')} color="#1769e0" tint="#e4edfd">
              <strong>{t.method ? (METHOD_LABEL[t.method] ?? t.method) : '—'}</strong>
              {t.reference && <small>{tx('রেফারেন্স: {{p0}}', { p0: digits(t.reference) })}</small>}
            </Fact>
            <Fact icon={<BankFilled />} label={tx('লেনদেনের পর জের')} color="#8b3fe0" tint="#efe4fc">
              <strong>{t.balance_after === null ? '—' : `৳ ${money(t.balance_after)}`}</strong>
            </Fact>
            <Fact icon={green ? <CheckCircleFilled /> : <ClockCircleFilled />} label={tx('অবস্থা')} color={green ? '#1f9d55' : '#f5a524'} tint={green ? '#dcf3e5' : '#fdefd6'}>
              <strong>{statusLabel}</strong>
              {t.posted_at && <small>{fmtDateTime(t.posted_at)}</small>}
            </Fact>
          </div>

          <div className="id-two">
            <Box icon={<UserOutlined />} title={tx('সদস্যের তথ্য')}>
              <KV
                rows={[
                  [tx('সদস্য নং'), digits(t.account.member?.member_no ?? '—')],
                  [tx('সদস্যের নাম'), farmer ? <Link to={`/farmers/${farmer.id}`}>{nameOf(farmer)}</Link> : '—'],
                  [tx('কৃষক আইডি'), farmer ? digits(farmer.farmer_code) : '—'],
                  [tx('পিতার নাম'), farmer?.father_name],
                  [tx('মোবাইল নং'), farmer?.mobile ? digits(farmer.mobile) : '—'],
                ]}
              />
            </Box>
            <Box icon={<BankFilled />} title={tx('হিসাবের তথ্য')}>
              <KV
                rows={[
                  [tx('হিসাব নং'), <Link to={`/funds/${cfg.kind}/accounts/${t.account.id}`}>{digits(t.account.account_no)}</Link>],
                  [tx('হিসাবের বর্তমান জের'), `৳ ${money(t.account.balance)}`],
                  [
                    tx('ভাউচার'),
                    t.journal ? (
                      <>
                        {can('accounting.view') ? <Link to={`/accounting/journals/${t.journal.id}`}>{digits(t.journal.voucher_no)}</Link> : digits(t.journal.voucher_no)}
                        {t.journal.reversed_by && ` (${tx('রিভার্সাল')}: ${digits(t.journal.reversed_by.voucher_no)})`}
                      </>
                    ) : (
                      '—'
                    ),
                  ],
                  [tx('তহবিল'), t.method === 'cash' ? tx('নগদ') : t.fund ? accountLabel(t.fund) : '—'],
                  [cfg.by, nameOf(t.creator) || '—'],
                  [tx('মন্তব্য'), t.remarks || '—'],
                ]}
              />
            </Box>
          </div>

          <div id="history">
            <Box icon={<HistoryOutlined />} title={tx('ইতিহাস')}>
              <Table
                rowKey="id"
                size="small"
                className="id-payments"
                pagination={false}
                dataSource={t.timeline}
                locale={{ emptyText: tx('কোনো ইতিহাস নেই') }}
                columns={[
                  { title: tx('সময়'), dataIndex: 'at', render: (v: string) => fmtDateTime(v) },
                  { title: tx('কার্যক্রম'), dataIndex: 'event', render: (e: string | null, r) => <Tag className={`fl-tag hs-kind ${EVENT_TONE[e ?? ''] ?? 'll-gray'}`}>{r.event_label}</Tag> },
                  { title: tx('সম্পাদনকারী'), dataIndex: 'by', render: (b) => nameOf(b) || '—' },
                  { title: tx('কারণ'), dataIndex: 'reason', render: (v: string | null) => v || '—' },
                ]}
              />
            </Box>
          </div>
        </PageFrame>
      </div>

      <div className="print-only">
        <FundReceipt t={t} kind={cfg.kind} />
      </div>

      <Modal open={cancelling} forceRender title={tx('{{p0}} বাতিল', { p0: cfg.noun })} onCancel={() => setCancelling(false)} onOk={cancel} okText={tx('অনুমোদনে পাঠান')} okButtonProps={{ danger: true }} cancelText={tx('ফিরে যান')}>
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
