import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, Modal, Select, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarOutlined, CloseOutlined, EnvironmentOutlined, EyeOutlined, FileTextFilled, ReloadOutlined, SaveOutlined, SearchOutlined, SettingFilled, UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useInvoiceMeta, type Owner, type Person } from '../../lib/irrigation'
import { CULTIVATION_COLOR } from '../../lib/land'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres } from '../lands/ListFrame'
import '../lands/land-form.css'
import './invoices.css'
import './bulk-invoice.css'

type Line = {
  land_id: number
  farmer_id: number | null
  ok: boolean
  reason: string | null
  land_code: string
  mouza: string | null
  mouza_en: string | null
  dag_no: string
  khatian_no: string
  cultivator: (Person & { mobile?: string | null }) | null
  owners: Owner[]
  cultivation_type: string | null
  land_type: string | null
  irrigation_type: string | null
  area_decimal: number
  rate: number | null
  amount: number
}
type Preview = { summary: { lands: number; invoices: number; farmers: number; area: number; amount: number; skipped: Record<string, number> }; lines: Line[] }
type Batch = { id: number; invoice_count: number; total_amount: number; skipped_count: number }
type Tab = 'all' | 'selected' | 'skipped'

function Step({ no, label, state }: { no: number; label: string; state: 'done' | 'on' | 'todo' }) {
  return (
    <div className={`bi-step bi-step-${state}`}>
      <span>{digits(no)}</span>
      <strong>{label}</strong>
    </div>
  )
}

function Row2({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <span>:</span>
      <dd>{v}</dd>
    </div>
  )
}

/** Bill many plots at once: choose season, source and mouza, load the eligible plots, tick the ones to bill. */
export default function BulkInvoicePage() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sent, setSent] = useState<Record<string, unknown> | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Batch | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const { data: meta } = useInvoiceMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const seasonId: number | undefined = Form.useWatch('season_id', form)
  const typeId: number | undefined = Form.useWatch('irrigation_type_id', form)
  const mouzaId: number | undefined = Form.useWatch('mouza_id', form)
  const date: Dayjs | undefined = Form.useWatch('invoice_date', form)

  const ok = useMemo(() => preview?.lines.filter((l) => l.ok) ?? [], [preview])
  const chosen = ok.filter((l) => selected.includes(l.land_id))
  const chosenAmount = chosen.reduce((s, l) => s + l.amount, 0)
  const rows = (tab === 'all' ? ok : tab === 'selected' ? chosen : (preview?.lines.filter((l) => !l.ok) ?? [])).filter(
    (l) => !search || `${l.land_code} ${l.dag_no} ${l.cultivator?.name_bn ?? ''} ${l.cultivator?.name_en ?? ''} ${l.cultivator?.farmer_code ?? ''} ${l.cultivator?.mobile ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  )

  const load = async () => {
    const v = await form.validateFields()
    const body = { season_id: v.season_id, mouza_id: v.mouza_id ?? null, irrigation_type_id: v.irrigation_type_id ?? null, invoice_date: (v.invoice_date as Dayjs).format('YYYY-MM-DD') }
    setBusy(true)
    try {
      const p = (await api.post<Preview>('/invoices/bulk/preview', body)).data
      setPreview(p)
      setSent(body)
      setSelected(p.lines.filter((l) => l.ok).map((l) => l.land_id))
      setTab('all')
      setDone(null)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const generate = () => {
    if (!sent || !chosen.length) return
    modal.confirm({
      title: tx('{{p0}}টি ইনভয়েস তৈরি করবেন?', { p0: digits(chosen.length) }),
      content: tx('মোট ৳{{p0}}। প্রতিটি ইনভয়েসের হিসাব (পাওনা/আয়) সাথে সাথে খাতায় উঠবে।', { p0: money(chosenAmount) }),
      okText: tx('হ্যাঁ, তৈরি করুন'),
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const b = (await api.post<Batch>('/invoices/bulk', { ...sent, land_ids: chosen.map((l) => l.land_id) })).data
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
          queryClient.invalidateQueries({ queryKey: ['seasons'] })
          setDone(b)
          message.success(tx('{{p0}}টি ইনভয়েস তৈরি হয়েছে', { p0: digits(b.invoice_count) }))
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })
  }

  if (!meta) return <Spin />
  const step = done ? 4 : preview ? (chosen.length ? 3 : 2) : 1
  const st = (n: number): 'done' | 'on' | 'todo' => (n < step ? 'done' : n === step ? 'on' : 'todo')
  const season = meta.seasons.find((x) => x.id === seasonId)
  const typeName = meta.irrigation_types.find((t) => t.id === typeId)?.name_bn ?? tx('সব উৎস')
  const mouzaName = mouzas.data?.find((m) => m.id === mouzaId)
  const skipped = preview ? preview.lines.length - ok.length : 0

  const columns: ColumnsType<Line> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
    { title: tx('কৃষক আইডি'), render: (_, l) => (l.cultivator ? digits(l.cultivator.farmer_code) : '—') },
    { title: tx('কৃষকের নাম'), render: (_, l) => (l.cultivator ? nameOf(l.cultivator) : '—') },
    { title: tx('মোবাইল নং'), render: (_, l) => (l.cultivator?.mobile ? digits(l.cultivator.mobile) : '—') },
    { title: tx('মৌজা'), render: (_, l) => nameOf({ name_bn: l.mouza, name_en: l.mouza_en }) || '—' },
    { title: tx('দাগ / জমি নং'), render: (_, l) => `${digits(l.dag_no)} · ${l.land_code}` },
    { title: tx('চাষ'), dataIndex: 'cultivation_type', render: (v: string | null) => (v ? <Tag color={CULTIVATION_COLOR[v]}>{meta.cultivation_types[v] ?? v}</Tag> : '—') },
    { title: tx('পরিমাণ (একর)'), dataIndex: 'area_decimal', align: 'right', render: (v: number) => acres(v) },
    { title: tx('রেট (৳/শতক)'), dataIndex: 'rate', align: 'right', render: (v: number | null) => (v === null ? '—' : money(v)) },
    tab === 'skipped'
      ? { title: tx('কারণ'), dataIndex: 'reason', render: (v: string) => <Tag color="orange">{meta.skip_reasons[v] ?? v}</Tag> }
      : { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
  ]

  return (
    <PageFrame
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('একসাথে ইনভয়েস') }]}
      title={tx('একসাথে সেচ ইনভয়েস তৈরি')}
      subtitle={tx('একটি মৌসুম, মৌজা ও সেচের উৎসের জন্য একবারে অনেক সেচ ইনভয়েস তৈরি করুন।')}
    >
      <div className="bi-steps">
        <Step no={1} label={tx('শর্ত বাছাই')} state={st(1)} />
        <Step no={2} label={tx('কৃষক ও জমি বাছাই')} state={st(2)} />
        <Step no={3} label={tx('যাচাই ও তৈরি')} state={st(3)} />
        <Step no={4} label={tx('নিশ্চিতকরণ')} state={st(4)} />
      </div>

      <div className="bi-top">
        <section className="lf-card iv-section">
          <header className="lf-card-head">
            <SettingFilled className="iv-section-icon" />
            <h3>{digits(1)}. {tx('ইনভয়েসের শর্ত বাছাই')}</h3>
          </header>
          <div className="lf-card-body">
            <Form
              form={form}
              layout="vertical"
              className="iv-form"
              initialValues={{ season_id: meta.seasons.find((x) => x.status === 'open')?.id, invoice_date: dayjs() }}
              onValuesChange={() => {
                setPreview(null)
                setSelected([])
                setDone(null)
              }}
            >
              <div className="iv-grid iv-grid-3">
                <Form.Item name="season_id" label={tx('মৌসুম')} rules={[{ required: true, message: tx('মৌসুম বাছাই করুন') }]}>
                  <Select prefix={<DashIcon name="sprout" size={16} color="#1f9d55" stroke={2.2} />} options={meta.seasons.map((x) => ({ value: x.id, label: x.name_bn, disabled: x.status === 'closed' }))} />
                </Form.Item>
                <Form.Item name="irrigation_type_id" label={tx('সেচের উৎস')}>
                  <Select allowClear prefix={<DashIcon name="drop" size={16} color="#1769e0" stroke={2.2} />} placeholder={tx('সব উৎস')} options={meta.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                </Form.Item>
                <Form.Item name="mouza_id" label={tx('মৌজা')}>
                  <Select allowClear prefix={<EnvironmentOutlined />} placeholder={tx('সব মৌজা')} showSearch={{ optionFilterProp: 'label' }} options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))} />
                </Form.Item>
                <Form.Item name="invoice_date" label={tx('ইনভয়েসের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                  <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
                <Form.Item label={tx('রেট')} className="bi-span2">
                  <Input disabled value={tx('প্রতিটি জমির ধরন ও সেচের উৎস অনুযায়ী অনুমোদিত রেট (৳/শতক)')} />
                </Form.Item>
              </div>
            </Form>
          </div>
        </section>

        <aside className="lf-card iv-section bi-summary">
          <header className="lf-card-head">
            <FileTextFilled className="iv-section-icon" />
            <h3>{tx('একসাথে ইনভয়েসের সারাংশ')}</h3>
          </header>
          <dl className="id-kv bi-kv">
            <Row2 k={tx('মৌসুম')} v={season?.name_bn ?? '—'} />
            <Row2 k={tx('সেচের উৎস')} v={typeName} />
            <Row2 k={tx('মৌজা')} v={mouzaName ? nameOf(mouzaName) : tx('সব মৌজা')} />
            <Row2 k={tx('ইনভয়েসের তারিখ')} v={date ? fmtDate(date.format('YYYY-MM-DD')) : '—'} />
            <Row2 k={tx('বাছাই করা ইনভয়েস')} v={<strong>{preview ? digits(chosen.length) : '—'}</strong>} />
            <Row2 k={tx('বাদ পড়বে')} v={preview ? digits(skipped) : '—'} />
            <Row2 k={tx('আনুমানিক টাকা')} v={<strong>{preview ? `৳ ${money(chosenAmount)}` : '—'}</strong>} />
          </dl>
        </aside>
      </div>

      {done && (
        <div className="bi-done">
          <strong>{tx('{{p0}}টি ইনভয়েস তৈরি হয়েছে', { p0: digits(done.invoice_count) })}</strong>
          <span>{tx('মোট ৳{{p0}}; বাদ পড়েছে {{p1}}টি জমি।', { p0: money(done.total_amount), p1: digits(done.skipped_count) })}</span>
          <Button type="primary" onClick={() => navigate(`/irrigation/invoices?batch_id=${done.id}`)}>
            {tx('ইনভয়েসগুলো দেখুন')}
          </Button>
        </div>
      )}

      <section className="lf-card iv-section">
        <header className="lf-card-head">
          <UserOutlined className="iv-section-icon" />
          <h3>{digits(2)}. {tx('কৃষক ও জমির রেকর্ড বাছাই')}</h3>
        </header>
        <div className="lf-card-body">
          <div className="bi-bar">
            <div className="bi-tabs">
              <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
                {tx('সব উপযুক্ত ({{p0}})', { p0: digits(ok.length) })}
              </button>
              <button type="button" className={tab === 'selected' ? 'on' : ''} onClick={() => setTab('selected')}>
                {tx('বাছাই করা ({{p0}})', { p0: digits(chosen.length) })}
              </button>
              <button type="button" className={tab === 'skipped' ? 'on' : ''} onClick={() => setTab('skipped')}>
                {tx('বাদ পড়বে ({{p0}})', { p0: digits(skipped) })}
              </button>
            </div>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('কৃষকের নাম বা জমির নং দিয়ে খুঁজুন...')} value={search} onChange={(e) => setSearch(e.target.value)} className="bi-search" />
            <Button icon={<ReloadOutlined />} loading={busy} className="bi-load" onClick={load}>
              {tx('উপযুক্ত রেকর্ড লোড করুন')}
            </Button>
          </div>
          <Table<Line>
            className="fl-table bi-table"
            rowKey="land_id"
            size="small"
            dataSource={rows}
            columns={columns}
            scroll={{ x: 'max-content' }}
            rowSelection={
              tab === 'skipped'
                ? undefined
                : { selectedRowKeys: selected, onChange: (keys) => setSelected((cur) => [...cur.filter((k) => !rows.some((r) => r.land_id === k)), ...(keys as number[])]), columnWidth: 40 }
            }
            pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [5, 10, 25, 50], showTotal: (t) => tx('মোট {{p0}}টি রেকর্ড ({{p1}}টি বাছাই করা)', { p0: digits(t), p1: digits(chosen.length) }) }}
            locale={{ emptyText: preview ? tx('কোনো রেকর্ড নেই') : tx('শর্ত বাছাই করে "উপযুক্ত রেকর্ড লোড করুন" চাপুন') }}
          />
        </div>
      </section>

      <div className="iv-actions">
        <Button icon={<CloseOutlined />} onClick={() => navigate('/irrigation/invoices')}>
          {tx('বাতিল')}
        </Button>
        <span className="iv-spacer" />
        <Button icon={<EyeOutlined />} disabled={!chosen.length} onClick={() => setShowSummary(true)}>
          {tx('ইনভয়েসের প্রিভিউ')}
        </Button>
        <Button type="primary" icon={<SaveOutlined />} disabled={!chosen.length || !!done} onClick={generate}>
          {tx('ইনভয়েস তৈরি করুন')}
        </Button>
      </div>

      <Modal open={showSummary} footer={null} title={tx('ইনভয়েসের প্রিভিউ')} onCancel={() => setShowSummary(false)} width={640}>
        <Table
          size="small"
          pagination={false}
          rowKey="type"
          dataSource={Object.entries(
            chosen.reduce<Record<string, { count: number; area: number; amount: number }>>((acc, l) => {
              const k = l.cultivation_type ?? 'own'
              acc[k] = acc[k] ?? { count: 0, area: 0, amount: 0 }
              acc[k].count++
              acc[k].area += l.area_decimal
              acc[k].amount += l.amount
              return acc
            }, {}),
          ).map(([type, v]) => ({ type, ...v }))}
          columns={[
            { title: tx('চাষের ধরন'), dataIndex: 'type', render: (v: string) => <Tag color={CULTIVATION_COLOR[v]}>{meta.cultivation_types[v] ?? v}</Tag> },
            { title: tx('ইনভয়েস'), dataIndex: 'count', align: 'right', render: (v) => digits(v) },
            { title: tx('পরিমাণ (একর)'), dataIndex: 'area', align: 'right', render: (v: number) => acres(v) },
            { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: money },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <strong>{tx('মোট')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <strong>{digits(chosen.length)}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                {acres(chosen.reduce((s, l) => s + l.area_decimal, 0))}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <strong>{money(chosenAmount)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Modal>
    </PageFrame>
  )
}
