import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Empty, Input, InputNumber, Modal, QRCode, Table, Tabs, Tag } from 'antd'
import { ArrowLeftOutlined, CameraOutlined, CheckCircleFilled, DollarOutlined, PlusOutlined, SearchOutlined, TeamOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import QrScanModal from '../../components/QrScanModal'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { appUrl } from '../../lib/phase8'
import { StatRow } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoice-detail.css'
import './field.css'

type Named = { name_bn: string; name_en?: string | null }
type FarmerHit = Named & { id: number; farmer_code: string; father_name: string | null; mobile: string | null; village: Named | null; member: { member_no: number; status: string } | null }
type Dues = {
  farmer: Named & { id: number; farmer_code: string; father_name: string | null; mobile: string | null }
  member: { id: number; member_no: number; status: string } | null
  member_active: boolean
  loan: { loan_no: string; due_now: number; penalty: number; payable: boolean } | null
  irrigation: { due: number }
  water?: { due: number; bills: unknown[] }
  share: { due: number }
  savings: { account_no: string | null }
  allocation: { parts: Record<string, number>; unallocated: number }
  modules: Record<string, string>
}
type Part = { module: string; amount: string }
type Payment = { id: number; payment_no: string; date: string; amount: string; status: string; created_at: string; verify_token?: string; parts: Part[]; farmer: (Named & { farmer_code: string }) | null }
type Mine = { today: Payment[]; today_total: number; holding: { count: number; amount: number; oldest: string | null }; modules: Record<string, string> }
type Collector = { id: number; name_bn: string; name_en: string | null; mobile: string | null; count: number; amount: number; oldest: string | null; pending_cancel: number }
type Deposit = { id: number; deposit_no: string; date: string; amount: string; payments_count: number; note: string | null; collector?: Named; receiver?: Named; journal?: { voucher_no: string } | null }

const STATUS_TONE: Record<string, string> = { posted: 'fl-tag-green', cancel_pending: 'fl-tag-gold', cancelled: 'll-gray' }

/**
 * Field collection. A field collector, on a phone, finds the farmer, sees
 * what is owed and takes the cash; the office later receives what each
 * collector holds. Users who can do both see two tabs.
 */
export default function FieldCollectPage() {
  const { can } = useAuth()
  const collector = can('field.create')
  const office = can('field.approve') || (can('field.view') && !collector)

  return (
    <PageFrame crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('মাঠে আদায়') }]} title={tx('মাঠে আদায়')} className="fc-page">
      {collector && office ? (
        <Tabs
          items={[
            { key: 'collect', label: tx('মাঠে আদায় নিন'), children: <CollectorView /> },
            { key: 'office', label: tx('অফিসে জমা'), children: <OfficeView /> },
          ]}
        />
      ) : collector ? (
        <CollectorView />
      ) : (
        <OfficeView />
      )}
    </PageFrame>
  )
}

// ------------------------------------------------------------------ collector

function CollectorView() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [term, setTerm] = useState('')
  const search = useDeferredValue(term.trim())
  const [farmerId, setFarmerId] = useState<number | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const typed = useDeferredValue(amount)
  const [done, setDone] = useState<Payment | null>(null)
  const [saving, setSaving] = useState(false)
  const [scan, setScan] = useState(false)

  const mine = useQuery({ queryKey: ['field-mine'], queryFn: async () => (await api.get<Mine>('/field/mine')).data })
  const hits = useQuery({
    queryKey: ['field-farmers', search],
    queryFn: async () => (await api.get<FarmerHit[]>('/field/farmers', { params: { search } })).data,
    enabled: !farmerId && search.length >= 2,
  })
  const dues = useQuery({
    queryKey: ['field-dues', farmerId, typed],
    queryFn: async () => (await api.get<Dues>('/field/dues', { params: { farmer_id: farmerId, amount: typed ?? 0 } })).data,
    enabled: !!farmerId,
    placeholderData: (prev) => prev,
  })
  const d = dues.data
  const owed = d ? round((d.loan?.payable ? d.loan.due_now : 0) + d.irrigation.due + (d.water?.due ?? 0) + d.share.due) : 0
  // first time the dues arrive, offer the whole amount owed
  const offered = useRef<number | null>(null)
  useEffect(() => {
    if (d && offered.current !== d.farmer.id) {
      offered.current = d.farmer.id
      setAmount(owed > 0 ? owed : null)
    }
  }, [d, owed])

  const reset = () => {
    setFarmerId(null)
    setAmount(null)
    setDone(null)
    setTerm('')
    offered.current = null
  }

  const collect = () => {
    if (!farmerId || !amount || amount <= 0) return
    modal.confirm({
      title: tx('৳{{p0}} আদায় করবেন?', { p0: money(amount) }),
      content: `${nameOf(d?.farmer)} (${digits(d?.farmer.farmer_code ?? '')})`,
      okText: tx('হ্যাঁ, আদায় করুন'),
      cancelText: tx('ফিরে যান'),
      onOk: async () => {
        setSaving(true)
        try {
          const res = await api.post<Payment & { message: string }>('/field/collect', { farmer_id: farmerId, amount })
          message.success(res.data.message)
          setDone(res.data)
          queryClient.invalidateQueries({ queryKey: ['field-mine'] })
        } catch (e) {
          message.error(errorMessage(e))
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const m = mine.data
  return (
    <div className="fc-wrap">
      <div className="fc-strip">
        <div>
          <small>{tx('আজ আদায়')}</small>
          <b>৳ {money(m?.today_total ?? 0)}</b>
          <span>{tx('{{p0}}টি রশিদ', { p0: digits(m?.today.filter((p) => p.status === 'posted').length ?? 0) })}</span>
        </div>
        <div className="fc-strip-hold">
          <small>{tx('হাতে আছে — অফিসে জমা বাকি')}</small>
          <b>৳ {money(m?.holding.amount ?? 0)}</b>
          <span>{m?.holding.oldest ? tx('{{p0}} থেকে', { p0: fmtDate(m.holding.oldest) }) : tx('সব জমা হয়ে গেছে')}</span>
        </div>
      </div>

      {done ? (
        <section className="fc-card fc-done">
          <CheckCircleFilled className="fc-done-icon" />
          <h3>{tx('আদায় হয়েছে')}</h3>
          <p className="fc-big">৳ {money(done.amount)}</p>
          <p>
            {tx('রশিদ নং')} <b>{digits(done.payment_no)}</b> · {nameOf(done.farmer)}
          </p>
          <ul className="fc-parts">
            {done.parts.map((p) => (
              <li key={p.module}>
                <span>{m?.modules[p.module] ?? p.module}</span>
                <b>৳ {money(p.amount)}</b>
              </li>
            ))}
          </ul>
          {done.verify_token && (
            <div className="fc-qr">
              <QRCode value={appUrl(`/verify/combined/${done.verify_token}`)} size={132} bordered={false} />
              <small>{tx('কৃষক এই QR স্ক্যান করে রশিদ যাচাই করতে পারবেন। মোবাইল নম্বর থাকলে SMS-এও রশিদ যাবে।')}</small>
            </div>
          )}
          <Button type="primary" size="large" block icon={<PlusOutlined />} onClick={reset}>
            {tx('নতুন আদায়')}
          </Button>
        </section>
      ) : farmerId ? (
        <section className="fc-card">
          <div className="fc-farmer">
            <div>
              <b>{nameOf(d?.farmer)}</b>
              <small>
                {digits(d?.farmer.farmer_code ?? '')}
                {d?.member ? ` · ${tx('সদস্য নং {{p0}}', { p0: digits(d.member.member_no) })}` : ` · ${tx('সদস্য নন')}`}
                {d?.farmer.father_name ? ` · ${tx('পিতা')}: ${d.farmer.father_name}` : ''}
              </small>
            </div>
            <Button icon={<ArrowLeftOutlined />} onClick={reset}>
              {tx('বদলান')}
            </Button>
          </div>
          {d && (
            <>
              <ul className="fc-dues">
                {d.loan && (
                  <li>
                    <span>
                      {tx('ঋণের কিস্তি')} <small>{digits(d.loan.loan_no)}</small>
                    </span>
                    <b>৳ {money(d.loan.payable ? d.loan.due_now : 0)}</b>
                  </li>
                )}
                <li>
                  <span>{tx('সেচ বিল')}</span>
                  <b>৳ {money(d.irrigation.due)}</b>
                </li>
                {!!d.water?.bills.length && (
                  <li>
                    <span>{tx('পানির বিল')}</span>
                    <b>৳ {money(d.water.due)}</b>
                  </li>
                )}
                {d.member_active && (
                  <li>
                    <span>{tx('শেয়ার (ন্যূনতম বাকি)')}</span>
                    <b>৳ {money(d.share.due)}</b>
                  </li>
                )}
                <li className="fc-dues-total">
                  <span>{tx('মোট বকেয়া')}</span>
                  <b>৳ {money(owed)}</b>
                </li>
              </ul>
              <label className="fc-label">{tx('কত টাকা নিলেন?')}</label>
              <InputNumber className="fc-amount" size="large" min={1} precision={0} prefix="৳" inputMode="numeric" value={amount} onChange={(v) => setAmount(v)} style={{ width: '100%' }} />
              {!!amount && (
                <p className="fc-split">
                  {Object.entries(d.allocation.parts)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${d.modules[k] ?? k} ৳${money(v)}`)
                    .join(' · ') || '—'}
                  {d.allocation.unallocated > 0 && <span className="fc-warn">{tx(' · ৳{{p0}} কোথাও জমা হবে না (সদস্য নন)', { p0: money(d.allocation.unallocated) })}</span>}
                </p>
              )}
              <Button type="primary" size="large" block icon={<DollarOutlined />} loading={saving} disabled={!amount || amount <= 0 || d.allocation.unallocated > 0} onClick={collect}>
                {amount ? tx('৳{{p0}} আদায় করুন', { p0: money(amount) }) : tx('আদায় করুন')}
              </Button>
            </>
          )}
        </section>
      ) : (
        <section className="fc-card">
          <div className="fc-search">
            <Input size="large" allowClear prefix={<SearchOutlined />} placeholder={tx('নাম, মোবাইল, কৃষক আইডি বা সদস্য নং')} value={term} onChange={(e) => setTerm(e.target.value)} />
            <Button size="large" icon={<CameraOutlined />} onClick={() => setScan(true)} aria-label={tx('QR স্ক্যান')} />
          </div>
          {search.length >= 2 ? (
            <ul className="fc-hits">
              {(hits.data ?? []).map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => setFarmerId(f.id)}>
                    <b>{nameOf(f)}</b>
                    <small>
                      {digits(f.farmer_code)}
                      {f.member ? ` · ${tx('সদস্য নং {{p0}}', { p0: digits(f.member.member_no) })}` : ''}
                      {f.village ? ` · ${nameOf(f.village)}` : ''}
                      {f.mobile ? ` · ${digits(f.mobile)}` : ''}
                    </small>
                  </button>
                </li>
              ))}
              {hits.isFetched && !hits.data?.length && <Empty description={tx('কাউকে পাওয়া যায়নি')} />}
            </ul>
          ) : (
            <p className="fc-hint">{tx('কৃষকের নাম বা মোবাইল লিখুন, অথবা কার্ডের QR স্ক্যান করুন।')}</p>
          )}
        </section>
      )}

      <section className="fc-card">
        <h4 className="fc-title">{tx('আজকের আদায়')}</h4>
        {m?.today.length ? (
          <ul className="fc-today">
            {m.today.map((p) => (
              <li key={p.id}>
                <span>
                  <b>{nameOf(p.farmer)}</b>
                  <small>
                    {digits(p.payment_no)} · {fmtDateTime(p.created_at).split(' ').slice(-2).join(' ')}
                  </small>
                </span>
                <span className="fc-today-amt">
                  ৳ {money(p.amount)}
                  {p.status !== 'posted' && <Tag className={`fl-tag ${STATUS_TONE[p.status] ?? 'll-gray'}`}>{p.status === 'cancelled' ? tx('বাতিল') : tx('বাতিলের অপেক্ষায়')}</Tag>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fc-hint">{tx('আজ এখনো কোনো আদায় হয়নি।')}</p>
        )}
      </section>

      <QrScanModal
        open={scan}
        onClose={() => setScan(false)}
        onCode={(code) => {
          setScan(false)
          setTerm(code)
        }}
      />
    </div>
  )
}

const round = (n: number) => Math.round(n * 100) / 100

// ------------------------------------------------------------------ office

function OfficeView() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [taking, setTaking] = useState<Collector | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['field-collectors'],
    queryFn: async () => (await api.get<{ collectors: Collector[]; holding: number; deposits: Deposit[] }>('/field/collectors')).data,
  })
  const holders = (data?.collectors ?? []).filter((c) => c.amount > 0)
  const oldest =
    holders
      .map((c) => c.oldest)
      .filter(Boolean)
      .sort()[0] ?? null
  const today = (data?.deposits ?? []).filter((x) => x.date === dayjs().format('YYYY-MM-DD'))

  return (
    <div className="fl ml pl">
      <StatRow
        cards={[
          { key: 'hold', label: tx('মাঠকর্মীদের হাতে (জমা বাকি)'), value: `৳ ${money(data?.holding ?? 0)}`, icon: 'cash', color: '#f08c00', tint: '#fdefd6' },
          { key: 'who', label: tx('যাদের কাছে টাকা আছে'), value: digits(holders.length), icon: '', glyph: <TeamOutlined />, color: '#1769e0', tint: '#e4edfd' },
          { key: 'oldest', label: tx('সবচেয়ে পুরনো জমা-বাকি'), value: oldest ? fmtDate(oldest) : '—', icon: '', glyph: <WalletFilled />, color: '#e5383b', tint: '#fde4e5' },
          { key: 'today', label: tx('আজ জমা নেওয়া হয়েছে'), value: `৳ ${money(today.reduce((n, x) => n + Number(x.amount), 0))}`, icon: 'bank', color: '#1f9d55', tint: '#dcf3e5' },
        ]}
      />
      <section className="fl-card fc-office">
        <h4 className="fc-title">{tx('মাঠকর্মী ও তাদের হাতের টাকা')}</h4>
        <Table<Collector>
          rowKey="id"
          size="middle"
          loading={isFetching}
          dataSource={data?.collectors ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('কোনো মাঠকর্মী নেই — ইউজার তৈরি করে "মাঠকর্মী" রোল দিন।') }}
          columns={[
            { title: tx('মাঠকর্মী'), render: (_, c) => <b>{nameOf(c)}</b> },
            { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v: string | null) => (v ? digits(v) : '—') },
            { title: tx('রশিদ'), dataIndex: 'count', align: 'right', render: (v: number) => digits(v) },
            { title: tx('হাতে আছে (৳)'), dataIndex: 'amount', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
            { title: tx('কবে থেকে'), dataIndex: 'oldest', render: (v: string | null) => (v ? fmtDate(v) : '—') },
            {
              title: tx('অ্যাকশন'),
              align: 'center',
              render: (_, c) =>
                can('field.approve') && c.amount > 0 ? (
                  <Button type="primary" icon={<WalletFilled />} onClick={() => setTaking(c)}>
                    {tx('জমা নিন')}
                  </Button>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </section>
      <section className="fl-card fc-office">
        <h4 className="fc-title">{tx('সাম্প্রতিক জমা')}</h4>
        <Table<Deposit>
          rowKey="id"
          size="small"
          dataSource={data?.deposits ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: tx('এখনো কোনো জমা হয়নি') }}
          columns={[
            { title: tx('জমা নং'), dataIndex: 'deposit_no', render: (v: string) => digits(v) },
            { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
            { title: tx('মাঠকর্মী'), render: (_, x) => nameOf(x.collector) },
            { title: tx('রশিদ'), dataIndex: 'payments_count', align: 'right', render: (v: number) => digits(v) },
            { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
            { title: tx('জমা নিয়েছেন'), render: (_, x) => nameOf(x.receiver) },
            { title: tx('ভাউচার'), render: (_, x) => (x.journal ? digits(x.journal.voucher_no) : '—') },
            { title: tx('মন্তব্য'), dataIndex: 'note', render: (v: string | null) => v || '—' },
          ]}
        />
      </section>
      <DepositModal
        collector={taking}
        onClose={() => setTaking(null)}
        onDone={(msg) => {
          message.success(msg)
          setTaking(null)
          queryClient.invalidateQueries({ queryKey: ['field-collectors'] })
        }}
      />
    </div>
  )
}

function DepositModal({ collector, onClose, onDone }: { collector: Collector | null; onClose: () => void; onDone: (message: string) => void }) {
  const { message } = App.useApp()
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const list = useQuery({
    queryKey: ['field-holding', collector?.id],
    queryFn: async () => (await api.get<{ payments: Payment[]; modules: Record<string, string> }>(`/field/collectors/${collector!.id}`)).data,
    enabled: !!collector,
  })
  useEffect(() => {
    if (collector) {
      setDate(dayjs())
      setNote('')
    }
  }, [collector])
  const rows = list.data?.payments ?? []
  const total = rows.reduce((n, p) => n + Number(p.amount), 0)

  const save = async () => {
    if (!collector) return
    setSaving(true)
    try {
      const res = await api.post<{ message: string }>('/field/deposits', { collector_id: collector.id, date: date.format('YYYY-MM-DD'), note: note || null })
      onDone(res.data.message)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!collector}
      width={720}
      title={tx('{{p0}}-এর কাছ থেকে টাকা জমা নিন', { p0: nameOf(collector) })}
      onCancel={onClose}
      onOk={save}
      okText={tx('৳{{p0}} জমা নিন', { p0: money(total) })}
      okButtonProps={{ loading: saving, disabled: !rows.length }}
      cancelText={tx('ফিরে যান')}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('টাকা গুনে মিলিয়ে নিন। জমা নিলে এই রশিদগুলোর টাকা সমিতির নগদে (সেচের অংশ সেচের নগদে) উঠবে।')} />
      {!!collector?.pending_cancel && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('{{p0}}টি রশিদ বাতিলের অপেক্ষায় — সেগুলো এই জমায় ধরা হবে না।', { p0: digits(collector.pending_cancel) })} />}
      <Table<Payment>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content', y: 280 }}
        columns={[
          { title: tx('রশিদ নং'), dataIndex: 'payment_no', render: (v: string, p) => <Link to={`/payments/combined/${p.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
          { title: tx('কৃষক'), render: (_, p) => nameOf(p.farmer) },
          { title: tx('খাত'), render: (_, p) => p.parts.map((x) => list.data?.modules[x.module] ?? x.module).join(', ') },
          { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
        ]}
      />
      <div className="fc-deposit-foot">
        <label>
          {tx('জমার তারিখ')}
          <DatePicker value={date} format="DD/MM/YYYY" allowClear={false} onChange={(v) => v && setDate(v)} disabledDate={(x) => x.isAfter(dayjs(), 'day')} />
        </label>
        <label className="fc-grow">
          {tx('মন্তব্য')}
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={tx('যেমন: সন্ধ্যায় গুনে জমা')} />
        </label>
      </div>
    </Modal>
  )
}
