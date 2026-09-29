import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarOutlined, CloseOutlined, CreditCardFilled, EnvironmentOutlined, EyeOutlined, FileTextFilled, FolderOpenFilled, InfoCircleFilled, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL, amountInWords, round2, useInvoiceMeta, type InvoiceRow, type ReceiptFund } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../lands/land-form.css'
import '../irrigation/invoices.css'
import '../irrigation/bulk-invoice.css'
import './collect.css'

type Row = InvoiceRow & { overdue: boolean }
type Filters = { season_id?: number; irrigation_type_id?: number; mouza_id?: number; search?: string; state: string; land_type_id?: number; from?: string; to?: string; farmer_id?: number }
type Batch = { receipts: { id: number; receipt_no: string; farmer_id: number; amount: number }[]; total: number }

/** Collect irrigation charges: find due invoices (any farmer), tick them, enter what is paid now; one receipt per farmer. */
export default function IrrigationCollectPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [sp] = useSearchParams()
  const [form] = Form.useForm()
  const init: Filters = { state: 'due', farmer_id: Number(sp.get('farmer_id')) || undefined }
  const [draft, setDraft] = useState<Filters>(init)
  const [filters, setFilters] = useState<Filters>(init)
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [pay, setPay] = useState<Record<number, number>>({})
  const [picked, setPicked] = useState<Record<number, Row>>({})
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [done, setDone] = useState<Batch | null>(null)
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const funds = useQuery({ queryKey: ['receipt-funds'], queryFn: async () => (await api.get<ReceiptFund[]>('/receipts/funds')).data })

  const params = {
    page,
    per_page: 10,
    season_id: filters.season_id,
    irrigation_type_id: filters.irrigation_type_id,
    mouza_id: filters.mouza_id,
    land_type_id: filters.land_type_id,
    farmer_id: filters.farmer_id,
    search: filters.search,
    from: filters.from,
    to: filters.to,
    due: filters.state === 'due' ? 1 : undefined,
    overdue: filters.state === 'overdue' ? 1 : undefined,
    status: ['unpaid', 'partial'].includes(filters.state) ? filters.state : undefined,
  }
  const { data, isFetching } = useQuery({
    queryKey: ['invoices', 'collect', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/invoices', { params })).data,
    placeholderData: keepPreviousData,
  })

  const method: string = Form.useWatch('method', form) ?? 'cash'
  const selected = Object.values(picked)
  const billed = round2(selected.reduce((s, i) => s + i.amount, 0))
  const paidBefore = round2(selected.reduce((s, i) => s + i.paid_amount, 0))
  const now = round2(selected.reduce((s, i) => s + (pay[i.id] ?? 0), 0))
  const remaining = round2(billed - paidBefore - now)
  const farmers = new Set(selected.map((i) => i.farmer_id)).size
  const fundOptions = (funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true))

  const toggle = (r: Row, on: boolean) => {
    setPicked((p) => {
      const n = { ...p }
      if (on) n[r.id] = r
      else delete n[r.id]
      return n
    })
    setPay((p) => ({ ...p, [r.id]: on ? (p[r.id] ?? r.due) : p[r.id] }))
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }

  const collect = async () => {
    const v = await form.validateFields()
    const items = selected.filter((i) => (pay[i.id] ?? 0) > 0).map((i) => ({ invoice_id: i.id, amount: pay[i.id] }))
    if (!items.length) {
      message.warning(tx('অন্তত একটি ইনভয়েসে টাকার পরিমাণ দিন।'))
      return
    }
    setSaving(true)
    try {
      const r = (
        await api.post<Batch>('/receipts/batch', {
          date: (v.date as Dayjs).format('YYYY-MM-DD'),
          method: v.method,
          fund_account_id: v.method === 'cash' ? null : v.fund_account_id,
          reference: v.reference,
          remarks: v.remarks,
          items,
        })
      ).data
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
      setPreview(false)
      setPicked({})
      setPay({})
      if (r.receipts.length === 1) navigate(`/payments/receipts/${r.receipts[0].id}`)
      else setDone(r)
      message.success(tx('{{p0}}টি রশিদ তৈরি হয়েছে।', { p0: digits(r.receipts.length) }))
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const rows = data?.data ?? []
  const allOn = rows.length > 0 && rows.every((r) => picked[r.id])
  const columns: ColumnsType<Row> = [
    {
      title: <Checkbox checked={allOn} indeterminate={!allOn && rows.some((r) => picked[r.id])} onChange={(e) => rows.forEach((r) => toggle(r, e.target.checked))} />,
      width: 40,
      render: (_, r) => <Checkbox checked={!!picked[r.id]} onChange={(e) => toggle(r, e.target.checked)} />,
    },
    { title: '#', width: 40, render: (_, __, i) => digits((page - 1) * 10 + i + 1) },
    { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no', render: (v: string, r) => <Link to={`/irrigation/invoices/${r.id}`} className="fl-link">{digits(v)}</Link> },
    { title: tx('কৃষকের নাম'), render: (_, r) => (r.cultivator ? nameOf(r.cultivator) : '—') },
    { title: tx('মোবাইল নং'), render: (_, r) => (r.cultivator?.mobile ? digits(r.cultivator.mobile) : '—'), responsive: ['xxl'] },
    { title: tx('মৌজা'), render: (_, r) => nameOf({ name_bn: r.mouza, name_en: r.mouza_en }) || '—' },
    { title: tx('দাগ / জমি নং'), render: (_, r) => digits(r.dag_no ?? '') },
    { title: tx('ইনভয়েসের তারিখ'), dataIndex: 'invoice_date', render: fmtDate },
    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
    { title: tx('পরিশোধিত (৳)'), dataIndex: 'paid_amount', align: 'right', render: money },
    { title: tx('বকেয়া (৳)'), dataIndex: 'due', align: 'right', render: (v: number, r) => <span className={r.overdue ? 'cl-over' : undefined}>{money(v)}</span> },
    {
      title: tx('এখন জমা (৳)'),
      width: 120,
      render: (_, r) => (
        <InputNumber
          min={0}
          max={r.due}
          className="cl-pay"
          value={pay[r.id] ?? r.due}
          disabled={!picked[r.id]}
          onChange={(v) => setPay((p) => ({ ...p, [r.id]: Math.min(r.due, Number(v ?? 0)) }))}
        />
      ),
    },
  ]

  return (
    <PageFrame crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচ চার্জ আদায়') }]} title={tx('সেচ চার্জ আদায়')} subtitle={tx('কৃষকদের সেচ ইনভয়েসের টাকা আদায় করুন।')}>
      <div className="bi-steps">
        <div className={`bi-step bi-step-${selected.length ? 'done' : 'on'}`}>
          <span>{digits(1)}</span>
          <strong>{tx('ইনভয়েস বাছাই')}</strong>
        </div>
        <div className={`bi-step bi-step-${selected.length ? (done ? 'done' : 'on') : 'todo'}`}>
          <span>{digits(2)}</span>
          <strong>{tx('পরিশোধের তথ্য')}</strong>
        </div>
        <div className={`bi-step bi-step-${preview ? 'on' : done ? 'done' : 'todo'}`}>
          <span>{digits(3)}</span>
          <strong>{tx('যাচাই ও নিশ্চিত')}</strong>
        </div>
        <div className={`bi-step bi-step-${done ? 'on' : 'todo'}`}>
          <span>{digits(4)}</span>
          <strong>{tx('রশিদ')}</strong>
        </div>
      </div>

      {done && (
        <div className="bi-done">
          <strong>{tx('{{p0}}টি রশিদ তৈরি হয়েছে', { p0: digits(done.receipts.length) })}</strong>
          <span>
            {tx('মোট ৳{{p0}}', { p0: money(done.total) })} ·{' '}
            {done.receipts.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <Link to={`/payments/receipts/${r.id}`}>{digits(r.receipt_no)}</Link>
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="cl-layout">
        <div className="cl-main">
          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <SearchOutlined className="iv-section-icon" />
              <h3>{digits(1)}. {tx('খুঁজুন ও ফিল্টার')}</h3>
            </header>
            <div className="lf-card-body cl-filters">
              <label>
                <span>{tx('মৌসুম')}</span>
                <Select allowClear placeholder={tx('সব মৌসুম')} prefix={<DashIcon name="sprout" size={16} color="#1f9d55" stroke={2.2} />} value={draft.season_id} options={meta?.seasons.map((x) => ({ value: x.id, label: x.name_bn }))} onChange={(v) => setDraft((d) => ({ ...d, season_id: v }))} />
              </label>
              <label>
                <span>{tx('সেচের উৎস')}</span>
                <Select allowClear placeholder={tx('সব উৎস')} prefix={<DashIcon name="drop" size={16} color="#1769e0" stroke={2.2} />} value={draft.irrigation_type_id} options={meta?.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} onChange={(v) => setDraft((d) => ({ ...d, irrigation_type_id: v }))} />
              </label>
              <label>
                <span>{tx('মৌজা')}</span>
                <Select allowClear placeholder={tx('সব মৌজা')} prefix={<EnvironmentOutlined />} showSearch={{ optionFilterProp: 'label' }} value={draft.mouza_id} options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))} onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v }))} />
              </label>
              <label>
                <span>{tx('কৃষকের নাম / মোবাইল')}</span>
                <Input allowClear placeholder={tx('নাম বা মোবাইল দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={apply} />
              </label>
              <label>
                <span>{tx('ইনভয়েসের অবস্থা')}</span>
                <Select
                  value={draft.state}
                  options={[
                    { value: 'due', label: tx('অপরিশোধিত / আংশিক') },
                    { value: 'unpaid', label: meta?.statuses.unpaid ?? 'unpaid' },
                    { value: 'partial', label: meta?.statuses.partial ?? 'partial' },
                    { value: 'overdue', label: tx('মেয়াদোত্তীর্ণ') },
                  ]}
                  onChange={(v) => setDraft((d) => ({ ...d, state: v }))}
                />
              </label>
              <label>
                <span>{tx('জমির ধরন')}</span>
                <Select allowClear placeholder={tx('সব ধরনের জমি')} value={draft.land_type_id} options={landMeta?.land_types.map((t) => ({ value: t.id, label: t.name_bn }))} onChange={(v) => setDraft((d) => ({ ...d, land_type_id: v }))} />
              </label>
              <label>
                <span>{tx('তারিখ (থেকে)')}</span>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} />
              </label>
              <label>
                <span>{tx('তারিখ (পর্যন্ত)')}</span>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} />
              </label>
              <div className="cl-filter-btns">
                <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
                  {tx('খুঁজুন')}
                </Button>
                <Button
                  onClick={() => {
                    setDraft({ state: 'due' })
                    setFilters({ state: 'due' })
                    setRange({})
                    setPage(1)
                  }}
                >
                  {tx('রিসেট')}
                </Button>
              </div>
            </div>
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FileTextFilled className="iv-section-icon" />
              <h3>{digits(2)}. {tx('আদায়ের জন্য ইনভয়েস বাছাই')}</h3>
            </header>
            <Table<Row>
              className="fl-table cl-table"
              rowKey="id"
              size="small"
              loading={isFetching}
              dataSource={rows}
              columns={columns}
              scroll={{ x: 'max-content' }}
              rowClassName={(r) => (picked[r.id] ? 'cl-on' : '')}
              pagination={{ current: page, pageSize: 10, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage, showTotal: (t) => tx('মোট {{p0}}টি বকেয়া ইনভয়েস', { p0: digits(t) }) }}
              locale={{ emptyText: tx('কোনো বকেয়া ইনভয়েস পাওয়া যায়নি') }}
            />
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FolderOpenFilled className="iv-section-icon" />
              <h3>{digits(3)}. {tx('আদায়ের প্রিভিউ')}</h3>
            </header>
            <div className="cl-preview">
              <div className="cl-total">
                <span className="cl-taka">৳</span>
                <div>
                  <small>{tx('মোট আদায়যোগ্য (বাছাই করা)')}</small>
                  <strong>৳ {money(now)}</strong>
                </div>
              </div>
              <div className="cl-words">
                <small>{tx('কথায়')}</small>
                <strong>{amountInWords(now)}</strong>
              </div>
              <div className="cl-hint">
                <InfoCircleFilled />
                {tx('এই টাকা আদায় হবে এবং প্রত্যেক কৃষকের জন্য আলাদা রশিদ তৈরি হবে।')}
              </div>
            </div>
          </section>
        </div>

        <aside className="cl-side">
          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FileTextFilled className="iv-section-icon" />
              <h3>{tx('আদায়ের সারাংশ')}</h3>
            </header>
            <dl className="cl-sum">
              <div>
                <dt>{tx('নির্বাচিত ইনভয়েস')}</dt>
                <dd>{digits(selected.length)}</dd>
              </div>
              <div>
                <dt>{tx('কৃষক')}</dt>
                <dd>{digits(farmers)}</dd>
              </div>
              <div>
                <dt>{tx('মোট ইনভয়েসের টাকা')}</dt>
                <dd>৳ {money(billed)}</dd>
              </div>
              <div>
                <dt>{tx('আগে পরিশোধিত')}</dt>
                <dd>৳ {money(paidBefore)}</dd>
              </div>
              <div className="cl-now">
                <dt>{tx('এখন আদায়')}</dt>
                <dd>৳ {money(now)}</dd>
              </div>
              <div className="cl-left">
                <dt>{tx('বাকি বকেয়া')}</dt>
                <dd>৳ {money(remaining)}</dd>
              </div>
            </dl>
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <CreditCardFilled className="iv-section-icon" />
              <h3>{tx('পরিশোধের তথ্য')}</h3>
            </header>
            <div className="lf-card-body">
              <Form form={form} layout="vertical" className="iv-form" initialValues={{ date: dayjs(), method: 'cash' }}>
                <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')} rules={[{ required: true }]}>
                  <Select options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
                {method !== 'cash' && (
                  <>
                    <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('যে হিসাবে জমা')} rules={[{ required: true, message: tx('হিসাব বাছাই করুন') }]}>
                      <Select options={fundOptions.map((a) => ({ value: a.id, label: accountLabel(a) + (a.account_no ? ` (${digits(a.account_no)})` : '') }))} />
                    </Form.Item>
                    <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[{ required: true, message: tx('রেফারেন্স দিন') }]}>
                      <Input maxLength={100} placeholder={tx('চেক/স্লিপ বা মোবাইল লেনদেন নম্বর')} />
                    </Form.Item>
                  </>
                )}
                <Form.Item name="date" label={tx('পরিশোধের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
                <Form.Item label={tx('গ্রহণকারী')}>
                  <Input disabled value={nameOf(user ?? { name_bn: '', name_en: null })} />
                </Form.Item>
                <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')}>
                  <Input.TextArea rows={3} maxLength={300} showCount placeholder={tx('মন্তব্য লিখুন (যদি থাকে)...')} />
                </Form.Item>
              </Form>
            </div>
          </section>
        </aside>
      </div>

      <div className="iv-actions">
        <Button icon={<CloseOutlined />} onClick={() => navigate(-1)}>
          {tx('বাতিল')}
        </Button>
        <span className="iv-spacer" />
        <Button icon={<EyeOutlined />} disabled={now <= 0} onClick={() => setPreview(true)}>
          {tx('রশিদের প্রিভিউ')}
        </Button>
        <Button type="primary" icon={<SaveOutlined />} disabled={now <= 0} loading={saving} onClick={collect}>
          {tx('টাকা আদায় ও রশিদ তৈরি')}
        </Button>
      </div>

      <Modal open={preview} width={720} title={tx('রশিদের প্রিভিউ')} onCancel={() => setPreview(false)} onOk={collect} confirmLoading={saving} okText={tx('টাকা আদায় ও রশিদ তৈরি')} cancelText={tx('ফিরে যান')}>
        <Table
          size="small"
          rowKey="farmer"
          pagination={false}
          dataSource={Object.values(
            selected.reduce<Record<number, { farmer: number; name: string; count: number; amount: number }>>((acc, i) => {
              acc[i.farmer_id] = acc[i.farmer_id] ?? { farmer: i.farmer_id, name: i.cultivator ? nameOf(i.cultivator) : '—', count: 0, amount: 0 }
              acc[i.farmer_id].count++
              acc[i.farmer_id].amount = round2(acc[i.farmer_id].amount + (pay[i.id] ?? 0))
              return acc
            }, {}),
          )}
          columns={[
            { title: tx('কৃষক'), dataIndex: 'name' },
            { title: tx('ইনভয়েস'), dataIndex: 'count', align: 'right', render: (v) => digits(v) },
            { title: tx('রশিদের টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
          ]}
        />
        <p className="cl-modal-total">
          {tx('মোট')}: <strong>৳ {money(now)}</strong> — {amountInWords(now)}
        </p>
      </Modal>
    </PageFrame>
  )
}
