import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Table, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, CloseOutlined, HistoryOutlined, PrinterOutlined, SaveOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundMemberPicker, { type FundLookup } from '../../components/FundMemberPicker'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { KIND_LABEL, useFundMeta, type FundTxn } from '../../lib/funds'
import { ENTRY, TXN_TONE, type EntryKey } from '../../lib/fundEntry'
import { METHOD_LABEL, type ReceiptFund } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import './savings.css'

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

/** Take a deposit (or a share payment) from one member: pick the member, the amount and how it was paid. */
export default function EntryFormPage({ entry }: { entry: EntryKey }) {
  const cfg = ENTRY[entry]
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [memberId, setMemberId] = useState<number | null>(null)
  const [row, setRow] = useState<FundLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const { data: meta } = useFundMeta(cfg.kind)
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const amount: number | undefined = Form.useWatch('amount', form)
  const remarks: string | undefined = Form.useWatch('remarks', form)

  const account = row?.account ?? null
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data, enabled: method !== 'cash' })
  const recent = useQuery({
    queryKey: ['fund-entries', cfg.key, 'recent', account?.id],
    queryFn: async () => (await api.get<Paginated<FundTxn>>(`/funds/${cfg.kind}/transactions`, { params: { member_account_id: account!.id, type: cfg.type, per_page: 5 } })).data.data,
    enabled: !!account,
  })

  // a withdrawal may not exceed the balance less what earlier requests already hold
  const detail = useQuery({
    queryKey: ['fund-account', cfg.kind, account?.id],
    queryFn: async () => (await api.get<{ available: number; held: number }>(`/funds/${cfg.kind}/accounts/${account!.id}`)).data,
    enabled: !!account && !!cfg.out,
  })
  const balance = account ? Number(account.balance) : 0
  const available = detail.data ? Number(detail.data.available) : balance
  const held = detail.data ? Number(detail.data.held) : 0
  const closed = account?.status === 'closed'
  const unitPrice = cfg.kind === 'share' ? (meta?.share_unit_price ?? null) : null
  const after = cfg.out ? balance - (amount ?? 0) : balance + (amount ?? 0)

  const openAccount = async () => {
    if (!row) return
    setOpening(true)
    try {
      const a = (await api.post<{ id: number; account_no: string; balance: string; status: string }>(`/funds/${cfg.kind}/accounts`, { member_id: row.id, opened_on: dayjs().format('YYYY-MM-DD') })).data
      setRow({ ...row, account: { id: a.id, account_no: a.account_no, balance: Number(a.balance), status: a.status } })
      message.success(tx('হিসাব {{p0}} খোলা হয়েছে।', { p0: digits(a.account_no) }))
      queryClient.invalidateQueries({ queryKey: ['fund-lookup', cfg.kind] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setOpening(false)
    }
  }

  const save = async (print: boolean) => {
    if (!account) return
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      const r = await api.post<{ id: number; txn_no: string; status: string; message: string }>(`/funds/${cfg.kind}/accounts/${account.id}/transactions`, {
        ...v,
        type: cfg.type,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method !== 'cash' ? v.fund_account_id : null,
      })
      message.success(r.data.status === 'pending' ? r.data.message : tx('{{p0}} {{p1}} সংরক্ষিত হয়েছে।', { p0: cfg.noun, p1: digits(r.data.txn_no) }))
      queryClient.invalidateQueries({ queryKey: ['fund-entries'] })
      queryClient.invalidateQueries({ queryKey: ['fund-lookup', cfg.kind] })
      navigate(`${cfg.base}/details/${r.data.id}${print ? '?print=1' : ''}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const reset = () => {
    form.resetFields()
    setMemberId(null)
    setRow(null)
  }
  const confirmSave = (print: boolean) =>
    amount && amount >= 50000
      ? modal.confirm({ title: tx('৳{{p0}} {{p1}} নিশ্চিত করুন', { p0: money(amount), p1: cfg.noun }), content: nameOf(row?.farmer), okText: tx('হ্যাঁ, সংরক্ষণ'), cancelText: tx('ফিরে যান'), onOk: () => save(print) })
      : save(print)

  const f = row?.farmer
  return (
    <PageFrame
      crumbs={[{ label: tx('সঞ্চয়'), to: cfg.base }, { label: cfg.list, to: cfg.base }, { label: cfg.add }]}
      title={cfg.add}
      actions={
        <>
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate(cfg.base)}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </>
      }
    >
      <Form
        form={form}
        layout="vertical"
        className="iv-form sv-form"
        initialValues={{ date: dayjs(), method: 'cash' }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && e.preventDefault()}
      >
        <Section no={1} icon={<UserOutlined />} title={tx('সদস্যের তথ্য')}>
          <div className="iv-grid iv-grid-3">
            <Form.Item label={tx('সদস্য বাছাই')} required className="sv-picker">
              <FundMemberPicker
                kind={cfg.kind}
                value={memberId}
                onChange={(id, r) => {
                  setMemberId(id)
                  setRow(r ?? null)
                }}
              />
            </Form.Item>
            <Form.Item label={tx('সদস্য নং')}>
              <Input disabled value={row ? digits(row.member_no) : ''} placeholder="—" />
            </Form.Item>
            <Form.Item label={tx('কৃষক আইডি')}>
              <Input disabled value={f ? digits(f.farmer_code) : ''} placeholder="F-000000" />
            </Form.Item>
            <Form.Item label={tx('পিতার নাম')}>
              <Input disabled value={f?.father_name ?? ''} />
            </Form.Item>
            <Form.Item label={tx('মোবাইল নং')}>
              <Input disabled value={digits(f?.mobile ?? '')} placeholder="01XXXXXXXXX" />
            </Form.Item>
            <Form.Item label={tx('হিসাব নং')}>
              <Input disabled value={account ? digits(account.account_no) : ''} />
            </Form.Item>
          </div>
          {row && !account && (
            <Alert
              type="warning"
              showIcon
              title={tx('এই সদস্যের কোনো {{p0}} হিসাব নেই।', { p0: KIND_LABEL[cfg.kind] })}
              action={
                !cfg.out &&
                can(`${cfg.kind}.create`) && (
                  <Button size="small" type="primary" loading={opening} onClick={openAccount}>
                    {tx('আজকের তারিখে হিসাব খুলুন')}
                  </Button>
                )
              }
            />
          )}
          {closed && <Alert type="error" showIcon title={tx('এই হিসাব বন্ধ — নতুন লেনদেন করা যাবে না।')} />}
          {account && !closed && (
            <div className="sv-balance">
              <span>
                {tx('বর্তমান জের')}: <strong>৳ {money(balance)}</strong>
                {cfg.out && (
                  <>
                    {' · '}
                    {tx('উত্তোলনযোগ্য')}: <strong>৳ {money(available)}</strong>
                    {held > 0 && <small className="sv-held">{tx('(৳{{p0}} আগের আবেদনে আটকে আছে)', { p0: money(held) })}</small>}
                  </>
                )}
              </span>
              <Link to={`/funds/${cfg.kind}/accounts/${account.id}`}>{tx('হিসাব বিবরণী দেখুন')}</Link>
            </div>
          )}
        </Section>

        <Section no={2} icon={<WalletOutlined />} title={cfg.section}>
          {cfg.out && <Alert type="info" showIcon className="sv-note" title={tx('ম্যানেজারের অনুমোদনের পর হিসাব থেকে টাকা কাটা হবে। ততক্ষণ এই টাকা হিসাবে আটকে থাকবে।')} />}
          <div className="iv-grid iv-grid-3">
            <Form.Item name="date" label={tx('তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
              <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
            {unitPrice && (
              // shares are bought in whole units: the count sets the amount
              <Form.Item label={tx('শেয়ার সংখ্যা (প্রতিটি ৳{{p0}})', { p0: money(unitPrice) })}>
                <InputNumber
                  min={1}
                  precision={0}
                  style={{ width: '100%' }}
                  value={amount ? amount / unitPrice : undefined}
                  onChange={(n) => form.setFieldValue('amount', n ? Number(n) * unitPrice : undefined)}
                />
              </Form.Item>
            )}
            <Form.Item
              name="amount"
              label={tx('টাকার পরিমাণ (৳)')}
              rules={[
                { required: true, message: tx('টাকার পরিমাণ দিন') },
                ...(unitPrice ? [{ validator: (_: unknown, v?: number) => (!v || Math.abs(v / unitPrice - Math.round(v / unitPrice)) < 1e-6 ? Promise.resolve() : Promise.reject(new Error(tx('শেয়ারের দামের (৳{{p0}}) গুণিতক হতে হবে', { p0: money(unitPrice) })))) }] : []),
              ]}
            >
              <InputNumber min={0.01} max={cfg.out && account ? available : undefined} precision={2} style={{ width: '100%' }} prefix="৳" placeholder="0.00" />
            </Form.Item>
            <Form.Item name="method" label={tx('মাধ্যম')}>
              <Select options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            {method !== 'cash' && (
              <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[{ required: true, message: tx('হিসাব বাছাই করুন') }]}>
                <Select
                  loading={funds.isFetching}
                  options={(funds.data ?? []).filter((a) => (method === 'bank' ? a.kind === 'bank' : true)).map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))}
                />
              </Form.Item>
            )}
            <Form.Item name="reference" label={tx('রেফারেন্স / বই রশিদ নং')}>
              <Input maxLength={100} placeholder={tx('যদি থাকে')} />
            </Form.Item>
          </div>
          <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} extra={<span className="iv-count">{tx('{{p0}}/৫০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
            <Input.TextArea rows={2} maxLength={500} placeholder={tx('মন্তব্য লিখুন (যদি থাকে)...')} />
          </Form.Item>
          <div className="iv-charge-foot">
            <span />
            <div className="iv-totals">
              <div>
                <span>{tx('বর্তমান জের')}</span>
                <span>{money(balance)}</span>
              </div>
              <div>
                <span>{cfg.out ? tx('এই {{p0}} (−)', { p0: cfg.noun }) : tx('এই {{p0}} (+)', { p0: cfg.noun })}</span>
                <span>{money(amount ?? 0)}</span>
              </div>
              <div className="iv-grand">
                <span>{tx('নতুন জের (৳)')}</span>
                <span>{money(after)}</span>
              </div>
            </div>
          </div>
        </Section>

        {account && (
          <Section no={3} icon={<HistoryOutlined />} title={tx('সাম্প্রতিক {{p0}}', { p0: cfg.noun })}>
            <Table<FundTxn>
              rowKey="id"
              size="small"
              className="id-payments"
              pagination={false}
              loading={recent.isFetching}
              dataSource={recent.data ?? []}
              locale={{ emptyText: tx('এখনো কোনো {{p0}} নেই', { p0: cfg.noun }) }}
              columns={[
                { title: cfg.no, dataIndex: 'txn_no', render: (v: string, t) => <Link to={`${cfg.base}/details/${t.id}`}>{digits(v)}</Link> },
                { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string | null) => (v ? (METHOD_LABEL[v] ?? v) : '—') },
                { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
                { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag ${TXN_TONE[v] ?? 'll-gray'}`}>{meta?.statuses[v] ?? v}</Tag> },
              ]}
            />
          </Section>
        )}

        <div className="iv-actions">
          <Button icon={<CloseOutlined />} onClick={() => navigate(-1)}>
            {tx('বাতিল')}
          </Button>
          <Button onClick={reset}>{tx('রিসেট')}</Button>
          <span className="iv-spacer" />
          <Button icon={<PrinterOutlined />} loading={saving} disabled={!account || closed || (!!cfg.out && available <= 0)} onClick={() => confirmSave(true)}>
            {tx('সংরক্ষণ ও প্রিন্ট')}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!account || closed || (!!cfg.out && available <= 0)} onClick={() => confirmSave(false)}>
            {cfg.out ? tx('অনুমোদনে পাঠান') : tx('{{p0}} সংরক্ষণ', { p0: cfg.noun })}
          </Button>
        </div>
      </Form>
    </PageFrame>
  )
}
