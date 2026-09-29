import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
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
  SearchOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import FundReceipt, { type FundTxnDetail } from '../../components/FundReceipt'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime, toEnDigits } from '../../lib/format'
import { useFundMeta, type FundTxn } from '../../lib/funds'
import { ENTRY, EVENT_TONE, TXN_TONE, type EntryKey } from '../../lib/fundEntry'
import { METHOD_LABEL } from '../../lib/irrigation'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../lands/land-history.css'
import './savings.css'

type Found = FundTxn & { account: { id: number; account_no: string; member: { member_no: number | string; farmer: { name_bn: string; name_en: string | null } | null } | null } | null }

/** Find an entry by its number, the member's name, number or mobile. */
function EntryLookup({ entry }: { entry: EntryKey }) {
  const cfg = ENTRY[entry]
  const navigate = useNavigate()
  const { data: meta } = useFundMeta(cfg.kind)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['fund-entries', cfg.key, 'lookup', search],
    queryFn: async () => (await api.get<Paginated<Found>>(`/funds/${cfg.kind}/transactions`, { params: { type: cfg.type, search: search || undefined, per_page: 10 } })).data,
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  // an exact number opens straight away
  useEffect(() => {
    if (search && rows.length === 1 && rows[0].txn_no.toLowerCase() === toEnDigits(search).toLowerCase()) navigate(`${cfg.base}/details/${rows[0].id}`)
  }, [search, rows, cfg.base, navigate])

  return (
    <PageFrame className="id-page" crumbs={[{ label: tx('সঞ্চয়'), to: cfg.base }, { label: cfg.list, to: cfg.base }, { label: cfg.detail }]} title={cfg.detail}>
      <section className="id-box sv-lookup">
        <header>
          <SearchOutlined />
          <h3>{tx('{{p0}} খুঁজুন', { p0: cfg.noun })}</h3>
        </header>
        <div className="sv-lookup-row">
          <Input
            size="large"
            prefix={<SearchOutlined />}
            allowClear
            autoFocus
            placeholder={tx('{{p0}}, সদস্যের নাম, সদস্য নং বা মোবাইল দিয়ে খুঁজুন...', { p0: cfg.no })}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onPressEnter={() => setSearch(term.trim())}
          />
          <Button size="large" type="primary" icon={<SearchOutlined />} onClick={() => setSearch(term.trim())}>
            {tx('খুঁজুন')}
          </Button>
        </div>
        <h4 className="sv-sub">{search ? tx('খোঁজের ফলাফল ({{p0}})', { p0: digits(data?.total ?? 0) }) : tx('সাম্প্রতিক {{p0}}', { p0: cfg.noun })}</h4>
        <Table<Found>
          rowKey="id"
          size="small"
          className="id-payments sv-pick"
          pagination={false}
          loading={isFetching}
          dataSource={rows}
          scroll={{ x: 'max-content' }}
          onRow={(r) => ({ onClick: () => navigate(`${cfg.base}/details/${r.id}`) })}
          locale={{ emptyText: tx('কোনো {{p0}} পাওয়া যায়নি', { p0: cfg.noun }) }}
          columns={[
            { title: cfg.no, dataIndex: 'txn_no', render: (v: string, r) => <Link to={`${cfg.base}/details/${r.id}`}>{digits(v)}</Link> },
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('সদস্যের নাম'), render: (_, r) => nameOf(r.account?.member?.farmer) || '—' },
            { title: tx('সদস্য নং'), render: (_, r) => digits(r.account?.member?.member_no ?? '—') },
            { title: tx('হিসাব নং'), render: (_, r) => digits(r.account?.account_no ?? '—') },
            { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag ${TXN_TONE[v] ?? 'll-gray'}`}>{meta?.statuses[v] ?? v}</Tag> },
          ]}
        />
      </section>
    </PageFrame>
  )
}

/** One deposit / share payment: who, how much, how it was paid, its voucher, its history, and the printable slip. */
export default function EntryDetailPage({ entry }: { entry: EntryKey }) {
  const { id } = useParams()
  return id ? <EntryDetail entry={entry} id={id} /> : <EntryLookup entry={entry} />
}

function EntryDetail({ entry, id }: { entry: EntryKey; id: string }) {
  const cfg = ENTRY[entry]
  const [sp] = useSearchParams()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
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
          {t.status === 'pending' && <Alert type="warning" showIcon className="id-alert" title={tx('এই লেনদেন অনুমোদনের অপেক্ষায় — অনুমোদনের পর হিসাবে যোগ হবে।')} />}
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
                  [tx('আদায়কারী'), nameOf(t.creator) || '—'],
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
