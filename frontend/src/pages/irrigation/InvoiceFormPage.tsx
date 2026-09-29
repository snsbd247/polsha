import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Spin, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, CloseOutlined, DeleteOutlined, FileTextFilled, PlusOutlined, SaveOutlined, UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { useInvoiceMeta, type Owner, type Person } from '../../lib/irrigation'
import { CULTIVATION_COLOR, type LandRow } from '../../lib/land'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres } from '../lands/ListFrame'
import '../lands/land-form.css'
import './invoices.css'

type Quote = {
  ok: boolean
  reason: string | null
  reason_label: string | null
  farmer_id: number | null
  cultivation_type: string | null
  irrigation_type_id: number | null
  area_decimal: number
  rate: number | null
  amount: number
  snapshot: { cultivator: Person | null; owners: Owner[]; land_area: number }
}
type Charge = { key: number; description: string; qty: number; rate: number }
type FarmerCard = { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null }

const landLabel = (l: LandRow) => `${l.land_code} — ${tx('দাগ')} ${digits(l.dag_no)} (${digits(Number(l.area_decimal))} ${tx('শতক')})`

function Section({ no, icon, title, children }: { no: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="lf-card iv-section">
      <header className="lf-card-head">
        <span className="iv-section-icon">{icon}</span>
        <h3>
          {digits(no)}. {title}
        </h3>
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** Bill one plot for a season: the irrigation charge from the approved rate, extra charges and a discount. */
export default function InvoiceFormPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [sp] = useSearchParams()
  const [form] = Form.useForm()
  const [term, setTerm] = useState('')
  const [farmerId, setFarmerId] = useState<number | null>(null)
  const [mouzaId, setMouzaId] = useState<number | undefined>()
  const [chosen, setChosen] = useState<LandRow | null>(null)
  const [charges, setCharges] = useState<Charge[]>([])
  const [discount, setDiscount] = useState(0)
  const [saving, setSaving] = useState(false)
  const { data: meta } = useInvoiceMeta()
  const presetLand = Number(sp.get('land_id')) || undefined
  const remarks: string | undefined = Form.useWatch('remarks', form)

  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const lands = useQuery({
    queryKey: ['land-search', term, farmerId, mouzaId],
    queryFn: async () => (await api.get<Paginated<LandRow>>('/lands', { params: { search: term || undefined, cultivator_id: farmerId ?? undefined, mouza_id: mouzaId, per_page: 30 } })).data.data,
  })
  const preset = useQuery({ queryKey: ['lands', String(presetLand)], queryFn: async () => (await api.get<LandRow>(`/lands/${presetLand}`)).data, enabled: !!presetLand })

  const seasonId: number | undefined = Form.useWatch('season_id', form)
  const landId: number | undefined = Form.useWatch('land_id', form)
  const date: Dayjs | undefined = Form.useWatch('invoice_date', form)
  const typeId: number | undefined = Form.useWatch('irrigation_type_id', form)
  const area: number | undefined = Form.useWatch('area_decimal', form)
  const payload = { season_id: seasonId, land_id: landId, invoice_date: date?.format('YYYY-MM-DD'), irrigation_type_id: typeId ?? null, area_decimal: area ?? null }

  const quote = useQuery({
    queryKey: ['invoice-quote', payload],
    queryFn: async () => (await api.post<Quote>('/invoices/quote', payload)).data,
    enabled: !!seasonId && !!landId && !!date,
    retry: false,
  })
  const q = quote.data
  // the farmer shown is whoever the bill goes to: the picked farmer, else the plot's cultivator
  const billTo = farmerId ?? q?.farmer_id ?? null
  const farmer = useQuery({ queryKey: ['farmers', billTo, 'card'], queryFn: async () => (await api.get<FarmerCard>(`/farmers/${billTo}`)).data, enabled: !!billTo })

  const picked = chosen ?? (landId && landId === preset.data?.id ? preset.data : null)
  const defaultSeason = (meta?.seasons.find((s) => s.status === 'open') ?? meta?.seasons.find((s) => s.status !== 'closed'))?.id
  if (!meta || (presetLand && preset.isLoading)) return <Spin />

  const extra = charges.reduce((s, c) => s + (c.qty || 0) * (c.rate || 0), 0)
  const subtotal = (q?.amount ?? 0) + extra
  const total = Math.max(0, subtotal - (discount || 0))

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const r = await api.post<{ id: number; invoice_no: string }>('/invoices', {
        ...payload,
        remarks: v.remarks,
        charges: charges.filter((c) => c.description.trim() && c.qty > 0).map(({ description, qty, rate }) => ({ description, qty, rate })),
        discount,
      })
      message.success(tx('ইনভয়েস {{p0}} তৈরি হয়েছে।', { p0: digits(r.data.invoice_no) }))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      navigate(`/irrigation/invoices/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const reset = () => {
    form.resetFields()
    setFarmerId(null)
    setMouzaId(undefined)
    setChosen(null)
    setCharges([])
    setDiscount(0)
  }
  const setCharge = (key: number, patch: Partial<Charge>) => setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  return (
    <PageFrame
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচ ইনভয়েস'), to: '/irrigation/invoices' }, { label: tx('নতুন ইনভয়েস') }]}
      title={tx('নতুন সেচ ইনভয়েস')}
      subtitle={tx('নতুন সেচ ইনভয়েস তৈরি করতে নিচের তথ্যগুলো দিন।')}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/irrigation/invoices')}>
          {tx('ইনভয়েস তালিকায় ফিরুন')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" className="iv-form" initialValues={{ season_id: defaultSeason, invoice_date: dayjs(), land_id: preset.data?.id }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && e.preventDefault()}>
        <Section no={1} icon={<UserOutlined />} title={tx('কৃষক ও জমির তথ্য')}>
          <div className="iv-grid iv-grid-3">
            <Form.Item label={tx('কৃষক বাছাই')} extra={tx('খালি রাখলে জমির বর্তমান চাষির নামে বিল হবে')}>
              <FarmerPicker
                value={farmerId}
                placeholder={tx('নাম, আইডি বা মোবাইল দিয়ে কৃষক খুঁজুন...')}
                onChange={(v) => {
                  setFarmerId(v)
                  setChosen(null)
                  form.setFieldsValue({ land_id: undefined })
                }}
              />
            </Form.Item>
            <Form.Item label={tx('কৃষক আইডি')}>
              <Input disabled value={farmer.data?.farmer_code ?? ''} placeholder="F-000000" />
            </Form.Item>
            <Form.Item label={tx('মোবাইল নং')}>
              <Input disabled value={digits(farmer.data?.mobile ?? '')} placeholder="01XXXXXXXXX" />
            </Form.Item>
            <Form.Item label={tx('মৌজা')}>
              <Select
                allowClear
                showSearch={{ optionFilterProp: 'label' }}
                placeholder={tx('মৌজা বাছাই করুন')}
                value={mouzaId}
                options={(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))}
                onChange={(v) => {
                  setMouzaId(v)
                  setChosen(null)
                  form.setFieldsValue({ land_id: undefined })
                }}
              />
            </Form.Item>
            <Form.Item name="land_id" label={tx('দাগ / জমি')} rules={[{ required: true, message: tx('জমি বাছাই করুন') }]}>
              <Select
                showSearch={{ filterOption: false, onSearch: setTerm }}
                loading={lands.isFetching}
                placeholder={tx('জমি বাছাই করুন (জমির নং / দাগ নং)')}
                options={[...(picked && !lands.data?.some((l) => l.id === picked.id) ? [picked] : []), ...(lands.data ?? [])].map((l) => ({ value: l.id, label: landLabel(l), land: l }))}
                onChange={(_, opt) => {
                  setChosen((opt as { land?: LandRow } | undefined)?.land ?? null)
                  form.setFieldsValue({ irrigation_type_id: undefined, area_decimal: undefined })
                }}
                notFoundContent={farmerId ? tx('এই কৃষক কোনো জমি চাষ করেন না') : undefined}
              />
            </Form.Item>
            <Form.Item label={tx('পরিমাণ (একর)')}>
              <Input disabled value={picked ? acres(Number(picked.area_decimal)) : digits('0.00')} />
            </Form.Item>
          </div>
        </Section>

        <Section no={2} icon={<DashIcon name="drop" size={20} color="#1769e0" stroke={2.2} />} title={tx('সেচের বিবরণ')}>
          <div className="iv-grid iv-grid-5">
            <Form.Item name="season_id" label={tx('মৌসুম')} rules={[{ required: true, message: tx('মৌসুম বাছাই করুন') }]}>
              <Select placeholder={tx('মৌসুম বাছাই করুন')} options={meta.seasons.map((s) => ({ value: s.id, label: s.name_bn, disabled: s.status === 'closed' }))} />
            </Form.Item>
            <Form.Item name="irrigation_type_id" label={tx('সেচের উৎস')} extra={tx('খালি = জমির সেচের ধরন')}>
              <Select allowClear placeholder={picked?.irrigation_type ?? tx('সেচের উৎস বাছাই করুন')} options={meta.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
            </Form.Item>
            <Form.Item name="invoice_date" label={tx('সেচের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
              <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
            </Form.Item>
            <Form.Item name="area_decimal" label={tx('সেচের জমি (শতক)')} extra={tx('খালি রাখলে পুরো জমি')}>
              <InputNumber min={0.01} max={picked ? Number(picked.area_decimal) : undefined} style={{ width: '100%' }} placeholder={picked ? digits(Number(picked.area_decimal)) : tx('যেমন: ৩৩')} />
            </Form.Item>
            <Form.Item label={tx('রেট (৳/শতক)')}>
              <Input disabled value={q?.rate != null ? money(q.rate) : ''} placeholder={tx('অনুমোদিত রেট')} />
            </Form.Item>
          </div>
          <Form.Item name="remarks" label={tx('মন্তব্য (ঐচ্ছিক)')} extra={<span className="iv-count">{tx('{{p0}}/৩০০ অক্ষর', { p0: digits(remarks?.length ?? 0) })}</span>}>
            <Input.TextArea rows={2} maxLength={300} placeholder={tx('মন্তব্য লিখুন (যদি থাকে)...')} />
          </Form.Item>
          {q && !q.ok && <Alert type="warning" showIcon title={tx('এই জমিতে ইনভয়েস করা যাবে না: {{p0}}', { p0: q.reason_label })} />}
          {quote.isError && <Alert type="error" showIcon title={errorMessage(quote.error)} />}
          {q?.ok && (
            <div className="iv-billto">
              {tx('বিল যার নামে')}: <strong>{q.snapshot.cultivator ? `${nameOf(q.snapshot.cultivator)} (${digits(q.snapshot.cultivator.farmer_code)})` : '—'}</strong>{' '}
              {q.cultivation_type && <Tag color={CULTIVATION_COLOR[q.cultivation_type]}>{meta.cultivation_types[q.cultivation_type]}</Tag>}
              {farmerId && q.farmer_id !== farmerId && <span className="iv-warn"> {tx('বাছাই করা কৃষক এই জমির চাষি নন; বিল চাষির নামে হবে।')}</span>}
            </div>
          )}
        </Section>

        <Section no={3} icon={<FileTextFilled />} title={tx('চার্জের বিবরণ')}>
          <table className="iv-charges">
            <thead>
              <tr>
                <th>#</th>
                <th>{tx('বিবরণ')}</th>
                <th>{tx('পরিমাণ')}</th>
                <th>{tx('রেট (৳)')}</th>
                <th>{tx('টাকা (৳)')}</th>
                <th>{tx('অ্যাকশন')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{digits(1)}</td>
                <td>{tx('সেচ চার্জ')}</td>
                <td>
                  <Input disabled value={q ? `${digits(q.area_decimal)} ${tx('শতক')}` : ''} />
                </td>
                <td>
                  <Input disabled value={q?.rate != null ? money(q.rate) : ''} />
                </td>
                <td>
                  <Input disabled className="iv-amt" value={money(q?.amount ?? 0)} />
                </td>
                <td />
              </tr>
              {charges.map((c, i) => (
                <tr key={c.key}>
                  <td>{digits(i + 2)}</td>
                  <td>
                    <Input value={c.description} placeholder={tx('যেমন: সার্ভিস চার্জ')} maxLength={100} onChange={(e) => setCharge(c.key, { description: e.target.value })} />
                  </td>
                  <td>
                    <InputNumber min={0} value={c.qty} onChange={(v) => setCharge(c.key, { qty: Number(v ?? 0) })} style={{ width: '100%' }} />
                  </td>
                  <td>
                    <InputNumber min={0} value={c.rate} onChange={(v) => setCharge(c.key, { rate: Number(v ?? 0) })} style={{ width: '100%' }} />
                  </td>
                  <td>
                    <Input disabled className="iv-amt" value={money((c.qty || 0) * (c.rate || 0))} />
                  </td>
                  <td>
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="iv-charge-foot">
            <Button className="iv-add" icon={<PlusOutlined />} onClick={() => setCharges((cs) => [...cs, { key: Date.now(), description: cs.length ? '' : tx('সার্ভিস চার্জ'), qty: 1, rate: 0 }])}>
              {tx('আরও চার্জ যোগ করুন')}
            </Button>
            <div className="iv-totals">
              <div>
                <span>{tx('উপমোট')}</span>
                <span>{money(subtotal)}</span>
              </div>
              <div>
                <span>{tx('ছাড় (-)')}</span>
                <InputNumber min={0} max={subtotal} value={discount} onChange={(v) => setDiscount(Number(v ?? 0))} className="iv-discount" />
              </div>
              <div className="iv-grand">
                <span>{tx('মোট টাকা (৳)')}</span>
                <span>{money(total)}</span>
              </div>
            </div>
          </div>
        </Section>

        <div className="iv-actions">
          <Button icon={<CloseOutlined />} onClick={() => navigate(-1)}>
            {tx('বাতিল')}
          </Button>
          <Button onClick={reset}>{tx('রিসেট')}</Button>
          <span className="iv-spacer" />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!q?.ok || total <= 0} onClick={save}>
            {tx('ইনভয়েস সংরক্ষণ')}
          </Button>
        </div>
      </Form>
    </PageFrame>
  )
}
