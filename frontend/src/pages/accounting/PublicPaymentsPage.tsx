import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Drawer, Form, Grid, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, ClockCircleFilled, CloseOutlined, EyeFilled, MobileOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { appPath, appUrl } from '../../lib/phase8'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../irrigation/rates.css'
import '../approvals/approvals.css'
import './accounting.css'

type Named = { id: number; name_bn: string; name_en: string | null } | null
type Req = {
  id: number
  request_no: string
  farmer_code: string
  farmer: (Named & { farmer_code: string; mobile?: string | null }) | null
  payer_name: string
  mobile: string
  method: string
  sender_number: string
  trx_id: string
  amount: string
  paid_on: string
  note: string | null
  status: 'pending' | 'verified' | 'rejected'
  reject_reason: string | null
  verifier: Named
  verified_at: string | null
  combined_payment: { id: number; payment_no: string } | null
  created_at: string
}
type ListResp = Paginated<Req> & {
  counts: Record<string, { n: number; amount: string }>
  statuses: Record<string, string>
  methods: Record<string, string>
}
type Parts = { loan: number; irrigation: number; share: number; savings: number }
type Detail = Req & {
  dues?: {
    member_active: boolean
    loan: { loan_no: string; due_now: number; payable: boolean } | null
    irrigation: { due: number }
    share: { due: number }
    savings: { account_no: string | null }
  }
  allocation?: { parts: Parts; unallocated: number }
  duplicate_trx: string[]
  funds: { id: number; code: string; name_bn: string; name_en: string | null; bank_account: { bank_name: string; account_no: string } | null }[]
}

const PART_LABEL: Record<keyof Parts, string> = { loan: tx('ঋণের কিস্তি'), irrigation: tx('সেচের বকেয়া'), share: tx('শেয়ার'), savings: tx('সঞ্চয়') }

function DetailDrawer({ id, meta, onClose, onDone }: { id: number | null; meta?: ListResp; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp()
  const { can } = useAuth()
  const [form] = Form.useForm()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({
    queryKey: ['public-payment', id],
    queryFn: async () => (await api.get<Detail>(`/public-payments/${id}`)).data,
    enabled: id !== null,
  })
  const canAct = can(['payment.create', 'payment.approve']) && data?.status === 'pending'

  const verify = async (v: { fund_account_id: number; parts: Parts }) => {
    setBusy(true)
    try {
      await api.post(`/public-payments/${id}/verify`, { fund_account_id: v.fund_account_id, parts: v.parts })
      message.success(tx('যাচাই হয়েছে; রশিদ তৈরি হয়েছে ও SMS পাঠানো হয়েছে।'))
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const reject = async () => {
    setBusy(true)
    try {
      await api.post(`/public-payments/${id}/reject`, { reason })
      message.success(tx('প্রত্যাখ্যান করা হয়েছে।'))
      setRejecting(false)
      onDone()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={id !== null} onClose={onClose} size="large" title={data ? tx('অনলাইন জমা {{no}}', { no: digits(data.request_no) }) : ''} destroyOnHidden>
      {!data ? (
        <Spin />
      ) : (
        <>
          {data.duplicate_trx.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('একই ট্রানজেকশন আইডি অন্য জমাতেও আছে: {{n}}', { n: digits(data.duplicate_trx.join(', ')) })} />}
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={tx('অবস্থা')}>
              <Tag className={`fl-tag ${STATUS_TONE[data.status] ?? 'll-gray'}`}>{meta?.statuses[data.status] ?? data.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={tx('কৃষক')}>
              {data.farmer ? (
                <Link to={`/farmers/${data.farmer.id}`}>
                  {digits(data.farmer.farmer_code)} — {nameOf(data.farmer)}
                </Link>
              ) : (
                digits(data.farmer_code)
              )}
            </Descriptions.Item>
            <Descriptions.Item label={tx('প্রদানকারী')}>{data.payer_name}</Descriptions.Item>
            <Descriptions.Item label={tx('মোবাইল')}>{digits(data.mobile)}</Descriptions.Item>
            <Descriptions.Item label={tx('মাধ্যম')}>{meta?.methods[data.method] ?? data.method}</Descriptions.Item>
            <Descriptions.Item label={tx('যে নম্বর থেকে পাঠানো')}>{digits(data.sender_number)}</Descriptions.Item>
            <Descriptions.Item label={tx('ট্রানজেকশন আইডি')}>
              <code>{data.trx_id}</code>
            </Descriptions.Item>
            <Descriptions.Item label={tx('টাকা')}>৳{money(data.amount)}</Descriptions.Item>
            <Descriptions.Item label={tx('পাঠানোর তারিখ')}>{fmtDate(data.paid_on)}</Descriptions.Item>
            {data.note && <Descriptions.Item label={tx('মন্তব্য')}>{data.note}</Descriptions.Item>}
            <Descriptions.Item label={tx('জমার সময়')}>{fmtDateTime(data.created_at)}</Descriptions.Item>
            {data.verifier && (
              <Descriptions.Item label={tx('নিষ্পত্তি করেছেন')}>
                {nameOf(data.verifier)} · {fmtDateTime(data.verified_at)}
              </Descriptions.Item>
            )}
            {data.combined_payment && (
              <Descriptions.Item label={tx('রশিদ')}>
                <Link to={`/payments/combined/${data.combined_payment.id}`}>{digits(data.combined_payment.payment_no)}</Link>
              </Descriptions.Item>
            )}
            {data.reject_reason && <Descriptions.Item label={tx('প্রত্যাখ্যানের কারণ')}>{data.reject_reason}</Descriptions.Item>}
          </Descriptions>

          {canAct && data.allocation && (
            <Form form={form} layout="vertical" style={{ marginTop: 16 }} onFinish={verify} initialValues={{ parts: data.allocation.parts, fund_account_id: data.funds.length === 1 ? data.funds[0].id : undefined }}>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('মার্চেন্ট স্টেটমেন্টে ট্রানজেকশন আইডি ও টাকা মিলিয়ে তবেই যাচাই করুন। বণ্টন কাউন্টারের মতোই (বকেয়া আগে, বাকি সঞ্চয়ে)।')} />
              <Form.Item name="fund_account_id" label={tx('টাকা কোন হিসাবে এসেছে')} rules={[{ required: true, message: tx('হিসাব বাছাই করুন') }]}>
                <Select
                  options={data.funds.map((f) => ({
                    value: f.id,
                    label: `${digits(f.code)} — ${nameOf(f)}${f.bank_account ? ` (${f.bank_account.bank_name} ${digits(f.bank_account.account_no)})` : ''}`,
                  }))}
                />
              </Form.Item>
              <Space wrap>
                {(Object.keys(PART_LABEL) as (keyof Parts)[]).map((k) => (
                  <Form.Item key={k} name={['parts', k]} label={PART_LABEL[k]}>
                    <InputNumber min={0} step={1} style={{ width: 140 }} />
                  </Form.Item>
                ))}
              </Space>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
                {tx('বকেয়া — ঋণ: {{l}}, সেচ: {{i}}, শেয়ার: {{s}}', {
                  l: money(data.dues?.loan?.payable ? data.dues.loan.due_now : 0),
                  i: money(data.dues?.irrigation.due),
                  s: money(data.dues?.share.due),
                })}
                {data.allocation.unallocated > 0 && ` · ${tx('বণ্টনহীন: {{a}}', { a: money(data.allocation.unallocated) })}`}
              </div>
              <Space>
                <Button type="primary" htmlType="submit" loading={busy}>
                  {tx('যাচাই করে রশিদ দিন')}
                </Button>
                <Button danger onClick={() => setRejecting(true)}>
                  {tx('প্রত্যাখ্যান')}
                </Button>
              </Space>
            </Form>
          )}
          {canAct && !data.allocation && (
            <Space style={{ marginTop: 16 }}>
              <Button danger onClick={() => setRejecting(true)}>
                {tx('প্রত্যাখ্যান')}
              </Button>
            </Space>
          )}
          <Modal open={rejecting} title={tx('জমা প্রত্যাখ্যান')} onCancel={() => setRejecting(false)} onOk={reject} okButtonProps={{ danger: true, disabled: !reason.trim(), loading: busy }} okText={tx('প্রত্যাখ্যান')}>
            <p>{tx('কারণটি প্রদানকারীকে SMS-এ জানানো হবে।')}</p>
            <Input.TextArea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Modal>
        </>
      )}
    </Drawer>
  )
}

type PPSettings = {
  public_payment_enabled: boolean
  public_payment_bkash: string
  public_payment_nagad: string
  public_payment_rocket: string
  public_payment_note: string
}

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm<PPSettings>()
  const { data } = useQuery({
    queryKey: ['public-payment-settings'],
    queryFn: async () => (await api.get<PPSettings>('/public-payments/settings')).data,
    enabled: open,
  })
  const save = async () => {
    try {
      const v = await form.validateFields()
      await api.put('/public-payments/settings', v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      onClose()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} title={tx('অনলাইন পেমেন্ট সেটিংস')} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} destroyOnHidden>
      {!data ? (
        <Spin />
      ) : (
        <Form form={form} layout="vertical" initialValues={data}>
          <Form.Item name="public_payment_enabled" label={tx('লগইন ছাড়া পেমেন্ট জমা চালু')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="public_payment_bkash" label={tx('বিকাশ মার্চেন্ট/পার্সোনাল নম্বর')}>
            <Input placeholder="01XXXXXXXXX" />
          </Form.Item>
          <Form.Item name="public_payment_nagad" label={tx('নগদ নম্বর')}>
            <Input placeholder="01XXXXXXXXX" />
          </Form.Item>
          <Form.Item name="public_payment_rocket" label={tx('রকেট নম্বর')}>
            <Input placeholder="01XXXXXXXXXX" />
          </Form.Item>
          <Form.Item name="public_payment_note" label={tx('পাবলিক পাতার নির্দেশনা')}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <p style={{ color: '#888', margin: 0 }}>
            {tx('পাবলিক পাতার ঠিকানা:')}{' '}
            <a href={appPath('/pay')} target="_blank" rel="noreferrer">
              {appUrl('/pay')}
            </a>
          </p>
        </Form>
      )}
    </Modal>
  )
}

const STATUS_TONE: Record<string, string> = { pending: 'fl-tag-gold', verified: 'fl-tag-green', rejected: 'fl-tag-red' }

/** Mobile-money payments reported on the public /pay page, waiting for a cashier to check and book them. */
export default function PublicPaymentsPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [status, setStatus] = useState('pending')
  const [draft, setDraft] = useState<{ method?: string; q?: string }>({})
  const [filters, setFilters] = useState<{ method?: string; q?: string }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [open, setOpen] = useState<number | null>(null)
  const [settings, setSettings] = useState(false)
  const params = { status: status === 'all' ? undefined : status, page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['public-payments', params],
    queryFn: async () => (await api.get<ListResp>('/public-payments', { params })).data,
    placeholderData: keepPreviousData,
  })
  const cnt = (s: string) => (data ? Number(data.counts[s]?.n ?? 0) : undefined)
  const amt = (s: string) => money(data?.counts[s]?.amount ?? 0)
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const tab = (s: string) => {
    setStatus(s)
    setPage(1)
  }

  const cards = [
    { key: 'pending', label: tx('যাচাইয়ের অপেক্ষায় · ৳{{p0}}', { p0: amt('pending') }), value: cnt('pending'), icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => tab('pending') },
    { key: 'verified', label: tx('যাচাইকৃত · ৳{{p0}}', { p0: amt('verified') }), value: cnt('verified'), icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => tab('verified') },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত'), value: cnt('rejected'), icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => tab('rejected') },
    {
      key: 'all',
      label: tx('মোট অনুরোধ'),
      value: data ? ['pending', 'verified', 'rejected'].reduce((s, k) => s + Number(data.counts[k]?.n ?? 0), 0) : undefined,
      icon: '',
      glyph: <MobileOutlined />,
      color: '#1769e0',
      tint: '#e4edfd',
      onClick: () => tab('all'),
    },
  ]
  const tabs = [
    { key: 'pending', label: tx('যাচাইয়ের অপেক্ষায়'), n: cnt('pending') },
    { key: 'verified', label: tx('যাচাইকৃত'), n: undefined },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত'), n: undefined },
    { key: 'all', label: tx('সব'), n: undefined },
  ]

  const columns: ColumnsType<Req> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('অনুরোধ নং'),
      dataIndex: 'request_no',
      render: (v: string, r) => (
        <a className="fl-link iv-no" onClick={() => setOpen(r.id)}>
          {digits(v)}
        </a>
      ),
    },
    { title: tx('জমার সময়'), dataIndex: 'created_at', render: fmtDateTime },
    {
      title: tx('কৃষক'),
      render: (_, r) =>
        r.farmer ? (
          <span className="hs-two">
            <Link to={`/farmers/${r.farmer.id}`} className="mg-name">
              {nameOf(r.farmer)}
            </Link>
            <span>{digits(r.farmer.farmer_code)}</span>
          </span>
        ) : (
          <span className="hs-two">
            <span className="mg-name">{r.payer_name}</span>
            <span>{digits(r.farmer_code)}</span>
          </span>
        ),
    },
    { title: tx('মাধ্যম'), dataIndex: 'method', render: (v: string) => <Tag className="fl-tag ll-purple">{data?.methods[v] ?? v}</Tag> },
    { title: tx('ট্রানজেকশন আইডি'), dataIndex: 'trx_id', render: (v: string) => <code>{v}</code> },
    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag iv-status ${STATUS_TONE[v] ?? 'll-gray'}`}>{data?.statuses[v] ?? v}</Tag> },
    { title: tx('রশিদ'), render: (_, r) => (r.combined_payment ? <Link to={`/payments/combined/${r.combined_payment.id}`}>{digits(r.combined_payment.payment_no)}</Link> : '—') },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setOpen(r.id)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('অনলাইন পেমেন্ট অনুরোধ')}
      subtitle=""
      actions={
        can(['payment.admin', 'settings.admin']) && (
          <Button icon={<SettingOutlined />} onClick={() => setSettings(true)}>
            {tx('সেটিংস')}
          </Button>
        )
      }
      cards={cards}
      above={
        <div className="lk-tabs ap-tabs">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={status === t.key ? 'on' : ''} onClick={() => tab(t.key)}>
              {t.label}
              {!!t.n && <span className="ap-count">{digits(t.n)}</span>}
            </button>
          ))}
        </div>
      }
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('নম্বর, TrxID, আইডি বা মোবাইল...')}
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value || undefined }))}
              onPressEnter={() => (setFilters(draft), setPage(1))}
            />
          </Field>
          <Field label={tx('মাধ্যম')}>
            <Select
              value={draft.method ?? ''}
              options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.methods ?? {}).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => setDraft((d) => ({ ...d, method: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters(draft)
        setPage(1)
      }}
      onReset={() => {
        setDraft({})
        setFilters({})
        setPage(1)
      }}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tabs.find((t) => t.key === status)?.label ?? '', p1: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Req>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো অনুরোধ নেই') }}
      />
      <DetailDrawer
        id={open}
        meta={data}
        onClose={() => setOpen(null)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['public-payments'] })
          queryClient.invalidateQueries({ queryKey: ['public-payment', open] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
      />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </ListFrame>
  )
}
