import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Table, Tag } from 'antd'
import { CalendarOutlined, CameraOutlined, CheckOutlined, EditOutlined, FileTextOutlined, PieChartOutlined, SettingOutlined, UndoOutlined, UnorderedListOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import PageFrame from '../../components/PageFrame'
import QrScanModal from '../../components/QrScanModal'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { METHOD_LABEL, round2, type ReceiptFund } from '../../lib/irrigation'
import { COMBINED_MODULES, MODULE_TONE, type CombinedModule, type CombinedQuote } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import { resolveQr } from '../qr/QrScannerPage'
import { KV } from '../irrigation/InvoiceDetailPage'
import '../lands/land-form.css'
import '../lands/land-list.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import '../loans/loans.css'
import './collect.css'

const MODULE_NAME: Record<CombinedModule, string> = { loan: tx('ঋণ'), irrigation: tx('সেচ'), share: tx('শেয়ার'), savings: tx('সঞ্চয়') }

function Section({ no, icon, title, children, extra }: { no: number; icon: ReactNode; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="lf-card iv-section">
      <header className="lf-card-head">
        <span className="iv-section-icon">{icon}</span>
        <h3>
          {digits(no)}. {title}
        </h3>
        {extra && <span className="sv-head-extra">{extra}</span>}
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** One payment at the counter, split over loan instalment, irrigation dues, share and savings. */
export default function CombinedPaymentPage({ tabs }: { tabs?: ReactNode }) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const [form] = Form.useForm()
  const [farmerId, setFarmerId] = useState<number | null>(Number(search.get('farmer_id')) || null)
  const [amount, setAmount] = useState<number | null>(null)
  const [debounced, setDebounced] = useState<number>(0)
  const [manual, setManual] = useState<Partial<Record<CombinedModule, number>> | null>(null)
  const [saving, setSaving] = useState(false)
  // the split is the system's until the user asks to change it
  const [editing, setEditing] = useState(false)
  // date, method and remarks stay folded away for the everyday cash receipt
  const [more, setMore] = useState(false)
  const [scan, setScan] = useState(false)

  useEffect(() => {
    const h = setTimeout(() => setDebounced(amount ?? 0), 300)
    return () => clearTimeout(h)
  }, [amount])

  const date: Dayjs = Form.useWatch('date', form) ?? dayjs()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const remarks: string | undefined = Form.useWatch('remarks', form)
  const quote = useQuery({
    queryKey: ['combined-quote', farmerId, date.format('YYYY-MM-DD'), debounced],
    queryFn: async () => (await api.get<CombinedQuote>('/combined-payments/quote', { params: { farmer_id: farmerId, date: date.format('YYYY-MM-DD'), amount: debounced } })).data,
    enabled: !!farmerId,
    placeholderData: keepPreviousData,
  })
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data })
  const q = farmerId ? quote.data : undefined
  const auto = q?.allocation.parts
  const parts: Record<CombinedModule, number> = { loan: 0, irrigation: 0, share: 0, savings: 0, ...(auto ?? {}), ...(manual ?? {}) }
  const partsSum = round2(COMBINED_MODULES.reduce((s, m) => s + (parts[m] || 0), 0))
  const gap = round2((amount ?? 0) - partsSum)
  const limits: Record<CombinedModule, number | undefined> = {
    loan: q?.loan?.payable ? q.loan.payoff : 0,
    irrigation: q?.irrigation.due ?? 0,
    share: q?.member_active ? undefined : 0,
    savings: q?.member_active ? undefined : 0,
  }
  const totalDue = q ? round2((q.loan?.payable ? q.loan.due_now : 0) + q.irrigation.due + q.share.due) : 0

  const pickFarmer = (id: number | null) => {
    setFarmerId(id)
    setAmount(null)
    setManual(null)
    setEditing(false)
  }
  // a farmer card or member QR: find whose it is and pick them
  const scanned = async (code: string, type: string | null) => {
    setScan(false)
    try {
      const r = await resolveQr(type === 'member' ? 'member' : 'farmer', code, 'camera')
      const id = Number(r.path?.match(/\/farmers\/(\d+)/)?.[1])
      if (id) pickFarmer(id)
      else message.warning(tx('এই QR কোনো কৃষকের নয়।'))
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const reset = () => {
    form.resetFields()
    pickFarmer(null)
  }

  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    if (!amount || amount <= 0) {
      message.warning(tx('মোট টাকার পরিমাণ দিন।'))
      return
    }
    if (gap !== 0) {
      message.warning(tx('ভাগের যোগফল মোট টাকার সমান হতে হবে।'))
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{ id: number; payment_no: string }>('/combined-payments', {
        ...v,
        farmer_id: farmerId,
        amount,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
        parts: manual ? parts : undefined,
      })
      message.success(tx('সমন্বিত রশিদ {{p0}} তৈরি হয়েছে।', { p0: digits(r.data.payment_no) }))
      for (const key of ['combined-payments', 'receipts', 'invoices', 'loans', 'loan-payments', 'fund-accounts', 'combined-quote', 'day-close']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      navigate(`/payments/combined/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const label = (m: CombinedModule) => q?.modules[m] ?? MODULE_NAME[m]
  const dueText = (m: CombinedModule) => {
    if (!q) return ''
    if (m === 'loan') return q.loan ? (q.loan.payable ? tx('কিস্তি বকেয়া ৳{{p0}} (সম্পূর্ণ পরিশোধ ৳{{p1}})', { p0: money(q.loan.due_now), p1: money(q.loan.payoff) }) : tx('ঋণ এখনো বিতরণ হয়নি')) : tx('চলমান ঋণ নেই')
    if (m === 'irrigation') return q.irrigation.invoices.length ? tx('{{p0}}টি ইনভয়েস, বকেয়া ৳{{p1}}', { p0: digits(q.irrigation.invoices.length), p1: money(q.irrigation.due) }) : tx('কোনো বকেয়া নেই')
    if (m === 'share') return q.member_active ? tx('জমা ৳{{p0}}, ন্যূনতম ৳{{p1}}', { p0: money(q.share.balance), p1: money(q.share.min) }) : tx('সক্রিয় সদস্য নন')
    return q.member_active ? tx('বর্তমান জমা ৳{{p0}}', { p0: money(q.savings.balance) }) : tx('সক্রিয় সদস্য নন')
  }

  return (
    <PageFrame
      crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('টাকা আদায়') }]}
      title={tx('টাকা আদায়')}
      actions={
        <Button icon={<UnorderedListOutlined />} className="fm-history-btn" onClick={() => navigate('/payments/receipts')}>
          {tx('রশিদের তালিকা')}
        </Button>
      }
    >
      {tabs}
      <div className="ln-form-grid">
        <Form form={form} layout="vertical" className="iv-form sv-form" initialValues={{ date: dayjs(), method: 'cash' }}>
          <Section no={1} icon={<UserOutlined />} title={tx('প্রদানকারী')}>
            <Form.Item label={tx('চাষি / সদস্য')} required>
              <Space.Compact style={{ width: '100%' }}>
                <FarmerPicker value={farmerId} onChange={(id) => pickFarmer(id)} initialLabel={q ? `${q.farmer.name_bn} (${q.farmer.farmer_code})` : undefined} placeholder={tx('নাম, কোড, NID বা মোবাইল লিখে খুঁজুন')} />
                <Button icon={<CameraOutlined />} onClick={() => setScan(true)} title={tx('কার্ডের QR স্ক্যান করুন')} aria-label={tx('কার্ডের QR স্ক্যান করুন')} />
              </Space.Compact>
            </Form.Item>
            {!farmerId && <Alert type="info" showIcon className="sv-note" title={tx('কৃষক খুঁজুন বা কার্ডের QR স্ক্যান করুন — তার সব বকেয়া (ঋণের কিস্তি, সেচ বিল, শেয়ার) দেখাবে; এক রশিদেই সব নেওয়া যাবে।')} />}
            {q && !q.member_active && <Alert type="warning" showIcon className="sv-note" title={tx('সক্রিয় সদস্য না হওয়ায় শুধু সেচ চার্জ নেওয়া যাবে; বাড়তি টাকা সঞ্চয়ে রাখা যাবে না।')} />}
          </Section>

          <Section
            no={2}
            icon={<PieChartOutlined />}
            title={tx('বকেয়া ও ভাগ')}
            extra={
              q &&
              (editing ? (
                <Space size={8}>
                  {manual && <Tag className="fl-tag fl-tag-gold">{tx('হাতে ভাগ করা')}</Tag>}
                  <Button size="small" icon={<UndoOutlined />} onClick={() => (setManual(null), setEditing(false))}>
                    {tx('স্বয়ংক্রিয় ভাগে ফিরুন')}
                  </Button>
                </Space>
              ) : (
                <Button size="small" icon={<EditOutlined />} disabled={!amount} onClick={() => setEditing(true)}>
                  {tx('ভাগ বদলান')}
                </Button>
              ))
            }
          >
            {!q ? (
              <p className="sv-foot-note">{quote.isFetching ? tx('লোড হচ্ছে...') : tx('প্রদানকারী বাছাই করলে বকেয়া ও ভাগ দেখা যাবে।')}</p>
            ) : (
              <>
                <p className="sv-foot-note">
                  {tx('ভাগের ক্রম')}: {[...q.order.map(label), label('savings')].join(' → ')}
                </p>
                <div className="id-payments">
                  <Table
                    rowKey="m"
                    size="small"
                    pagination={false}
                    loading={quote.isFetching}
                    scroll={{ x: 'max-content' }}
                    dataSource={COMBINED_MODULES.map((m) => ({ m }))}
                    summary={() => (
                      <Table.Summary.Row className="ln-sum-row">
                        <Table.Summary.Cell index={0} colSpan={2}>
                          {tx('মোট')}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <span style={{ color: gap !== 0 ? '#cf1322' : undefined }}>৳ {money(partsSum)}</span>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )}
                    columns={[
                      { title: tx('খাত'), width: 100, render: (_, { m }) => <Tag className={`fl-tag ${MODULE_TONE[m] ?? 'll-gray'}`}>{label(m)}</Tag> },
                      { title: tx('বকেয়া / অবস্থা'), render: (_, { m }) => dueText(m) },
                      {
                        title: tx('এখন জমা (৳)'),
                        width: 160,
                        align: 'right',
                        render: (_, { m }) => (
                          <InputNumber
                            min={0}
                            max={limits[m]}
                            precision={2}
                            disabled={!editing || limits[m] === 0}
                            value={parts[m] || null}
                            placeholder="0.00"
                            style={{ width: 140 }}
                            onChange={(v) => setManual({ ...parts, [m]: Number(v ?? 0) })}
                          />
                        ),
                      },
                    ]}
                  />
                </div>
                {q.allocation.unallocated > 0 && !manual && <Alert type="error" showIcon className="sv-note" title={tx('৳{{p0}} কোনো খাতে ভাগ করা যায়নি।', { p0: money(q.allocation.unallocated) })} />}
              </>
            )}
          </Section>

          <Section no={3} icon={<WalletOutlined />} title={tx('টাকা')}>
            <Form.Item label={tx('কত টাকা নিলেন? (৳)')} required extra={totalDue > 0 ? tx('মোট বকেয়া ৳{{p0}}', { p0: money(totalDue) }) : undefined}>
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  min={0}
                  precision={2}
                  prefix="৳"
                  placeholder="0.00"
                  size="large"
                  value={amount}
                  disabled={!q}
                  style={{ width: '100%' }}
                  onChange={(v) => {
                    setAmount(v === null ? null : Number(v))
                    setManual(null)
                    setEditing(false)
                  }}
                />
                <Button size="large" disabled={!totalDue} onClick={() => (setAmount(totalDue), setManual(null), setEditing(false))}>
                  {tx('সব বকেয়া')}
                </Button>
              </Space.Compact>
            </Form.Item>
            <div className="cp-more-line">
              <span>
                <CalendarOutlined /> {date.isSame(dayjs(), 'day') ? tx('আজ') : date.format('DD/MM/YYYY')} · {method === 'cash' ? tx('নগদ') : (METHOD_LABEL[method] ?? method)}
              </span>
              <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setMore((x) => !x)}>
                {more ? tx('লুকান') : tx('অন্য তারিখ / মাধ্যম / মন্তব্য')}
              </Button>
            </div>
            {/* folded, not removed: the form still needs the date and method */}
            <div style={{ display: more ? undefined : 'none' }}>
              <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} onChange={() => setManual(null)} />
              </Form.Item>
              <Form.Item name="method" label={tx('মাধ্যম')}>
                <Radio.Group optionType="button" options={Object.entries(METHOD_LABEL).map(([value, l]) => ({ value, label: value === 'other' ? tx('অন্যান্য') : l }))} />
              </Form.Item>
              {method === 'cash' ? (
                <Alert type="info" showIcon className="sv-note" title={tx('সেচের অংশ সেচ ক্যাশে এবং বাকি অংশ সমিতির ক্যাশে জমা হবে।')} />
              ) : (
                <div className="iv-grid iv-grid-2">
                  <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                    <Select options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))} />
                  </Form.Item>
                  <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[required(tx('রেফারেন্স দিন'))]} extra={tx('চেক/ডিপোজিট স্লিপ বা মোবাইল লেনদেন নম্বর')}>
                    <Input maxLength={100} />
                  </Form.Item>
                </div>
              )}
              <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} style={{ marginTop: 16 }} extra={<span className="iv-count">{tx('{{p0}}/৫০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
                <Input.TextArea rows={2} maxLength={500} placeholder={tx('মন্তব্য লিখুন (যদি থাকে)...')} />
              </Form.Item>
            </div>
          </Section>

          <div className="iv-actions">
            <Button icon={<UndoOutlined />} onClick={reset}>
              {tx('নতুন করে শুরু')}
            </Button>
            <span className="iv-spacer" />
            <Button type="primary" icon={<CheckOutlined />} loading={saving} disabled={!amount || gap !== 0 || !q} onClick={save}>
              {tx('টাকা নিন ও রশিদ দিন')}
            </Button>
          </div>
        </Form>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <UserOutlined />
              <h3>{tx('প্রদানকারীর তথ্য')}</h3>
            </header>
            {!q ? (
              <p className="sv-foot-note">{tx('প্রদানকারী বাছাই করলে তথ্য দেখা যাবে।')}</p>
            ) : (
              <KV
                rows={[
                  [tx('নাম'), <Link to={`/farmers/${q.farmer.id}`}>{nameOf(q.farmer)}</Link>],
                  [tx('কৃষক আইডি'), digits(q.farmer.farmer_code)],
                  [tx('পিতার নাম'), q.farmer.father_name || '—'],
                  [tx('মোবাইল নং'), q.farmer.mobile ? digits(q.farmer.mobile) : '—'],
                  [tx('সদস্য নং'), q.member ? digits(q.member.member_no) : tx('সদস্য নন')],
                  [tx('চলমান ঋণ'), q.loan ? digits(q.loan.loan_no) : '—'],
                ]}
              />
            )}
          </section>
          <section className="id-box">
            <header>
              <FileTextOutlined />
              <h3>{tx('রশিদের সারাংশ')}</h3>
            </header>
            <div className="ln-limit">
              <table className="ln-limit-table">
                <tbody>
                  {COMBINED_MODULES.map((m) => (
                    <tr key={m}>
                      <td>{label(m)}</td>
                      <td>৳ {money(parts[m] || 0)}</td>
                    </tr>
                  ))}
                  <tr className="ln-limit-total">
                    <td>{tx('মোট জমা')}</td>
                    <td>৳ {money(amount ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
              {gap !== 0 && amount ? <Alert type="warning" showIcon title={tx('ভাগের যোগফল থেকে মোট টাকা ৳{{p0}} আলাদা।', { p0: money(Math.abs(gap)) })} /> : null}
            </div>
          </section>
        </div>
      </div>
      <QrScanModal open={scan} onClose={() => setScan(false)} onCode={scanned} />
    </PageFrame>
  )
}
