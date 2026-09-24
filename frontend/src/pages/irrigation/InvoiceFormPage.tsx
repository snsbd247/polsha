import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Row, Select, Space, Spin, Tag } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { useInvoiceMeta, type Owner, type Person } from '../../lib/irrigation'
import { CULTIVATION_COLOR, fmtArea, useLandMeta, type LandRow } from '../../lib/land'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

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

const landLabel = (l: LandRow) => `${l.land_code} — ${l.mouza ?? ''}, ${tx('দাগ')} ${digits(l.dag_no)} (${digits(Number(l.area_decimal))} ${tx('শতক')})`

export default function InvoiceFormPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const [form] = Form.useForm()
  const [term, setTerm] = useState('')
  const [chosen, setChosen] = useState<LandRow | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const presetLand = Number(search.get('land_id')) || undefined

  const lands = useQuery({
    queryKey: ['land-search', term],
    queryFn: async () => (await api.get<Paginated<LandRow>>('/lands', { params: { search: term || undefined, per_page: 20 } })).data.data,
  })
  // Opened from a land's page: load that land so the select shows its label.
  const preset = useQuery({
    queryKey: ['lands', String(presetLand)],
    queryFn: async () => (await api.get<LandRow>(`/lands/${presetLand}`)).data,
    enabled: !!presetLand,
  })

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

  const picked = chosen ?? (landId && landId === preset.data?.id ? preset.data : null)
  const defaultSeason = (meta?.seasons.find((s) => s.status === 'open') ?? meta?.seasons.find((s) => s.status !== 'closed'))?.id
  if (!meta || (presetLand && preset.isLoading)) return <Spin />

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const r = await api.post<{ id: number; invoice_no: string }>('/invoices', { ...payload, remarks: v.remarks })
      message.success(tx('ইনভয়েস {{p0}} তৈরি হয়েছে।', { p0: digits(r.data.invoice_no) }))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      navigate(`/irrigation/invoices/${r.data.id}`)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const q = quote.data
  const typeName = (id?: number | null) => meta.irrigation_types.find((t) => t.id === id)?.name_bn

  return (
    <>
      <div className="page-header">
        <h2>{tx('নতুন সেচ ইনভয়েস')}</h2>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={tx('ইনভয়েসের তথ্য')}>
            <Form form={form} layout="vertical" initialValues={{ season_id: defaultSeason, invoice_date: dayjs(), land_id: preset.data?.id }} onFinish={save}>
              <Form.Item name="season_id" label={tx('মৌসুম')} rules={[required(tx('মৌসুম বাছাই করুন'))]}>
                <Select options={meta.seasons.map((s) => ({ value: s.id, label: s.name_bn, disabled: s.status === 'closed' }))} />
              </Form.Item>
              <Form.Item name="land_id" label={tx('জমি')} rules={[required(tx('জমি বাছাই করুন'))]} extra={tx('Land ID, দাগ, খতিয়ান বা মালিকের নাম লিখে খুঁজুন')}>
                <Select
                  showSearch={{ filterOption: false, onSearch: setTerm }}
                  loading={lands.isFetching}
                  options={[...(picked && !lands.data?.some((l) => l.id === picked.id) ? [picked] : []), ...(lands.data ?? [])].map((l) => ({ value: l.id, label: landLabel(l), land: l }))}
                  onChange={(_, opt) => {
                    const l = (opt as { land?: LandRow } | undefined)?.land ?? null
                    setChosen(l)
                    form.setFieldsValue({ irrigation_type_id: undefined, area_decimal: undefined })
                  }}
                />
              </Form.Item>
              <Form.Item name="invoice_date" label={tx('ইনভয়েসের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="irrigation_type_id" label={tx('সেচের ধরন')} extra={tx('খালি রাখলে জমির সেচের ধরন ধরা হবে')}>
                    <Select allowClear placeholder={picked?.irrigation_type ?? undefined} options={meta.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="area_decimal" label={tx('সেচের জমি (শতক)')} extra={tx('খালি রাখলে পুরো জমি')}>
                    <InputNumber min={0.01} max={picked ? Number(picked.area_decimal) : undefined} style={{ width: '100%' }} placeholder={picked ? digits(Number(picked.area_decimal)) : undefined} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={saving} disabled={!q?.ok}>
                  {tx('ইনভয়েস তৈরি')}
                </Button>
                <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={tx('হিসাব')} loading={quote.isFetching}>
            {!landId || !seasonId ? (
              <Alert type="info" showIcon title={tx('মৌসুম ও জমি বাছাই করলে বিলের হিসাব দেখা যাবে।')} />
            ) : quote.isError ? (
              <Alert type="error" showIcon title={errorMessage(quote.error)} />
            ) : q ? (
              <>
                {!q.ok && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('এই জমিতে ইনভয়েস করা যাবে না: {{p0}}', { p0: q.reason_label })} />}
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label={tx('চাষি (বিল যার নামে)')}>
                    {q.snapshot.cultivator ? `${nameOf(q.snapshot.cultivator)} (${digits(q.snapshot.cultivator.farmer_code)})` : '—'}{' '}
                    {q.cultivation_type && <Tag color={CULTIVATION_COLOR[q.cultivation_type]}>{meta.cultivation_types[q.cultivation_type]}</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx('মালিক')}>
                    {q.snapshot.owners.map((o) => tx('{{p0}} ({{p1}}%)', { p0: nameOf(o), p1: digits(o.share_percent) })).join(', ')}
                  </Descriptions.Item>
                  <Descriptions.Item label={tx('জমির ধরন')}>{picked?.land_type ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label={tx('সেচের ধরন')}>{typeName(q.irrigation_type_id) ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label={tx('সেচের জমি')}>{fmtArea(q.area_decimal, landMeta)}</Descriptions.Item>
                  <Descriptions.Item label={tx('রেট')}>{q.rate !== null ? tx('৳{{p0}} / শতক', { p0: money(q.rate) }) : '—'}</Descriptions.Item>
                  <Descriptions.Item label={tx('বিলের পরিমাণ')}>
                    <strong style={{ fontSize: 18 }}>৳{money(q.amount)}</strong>
                  </Descriptions.Item>
                </Descriptions>
                {q.cultivation_type && q.cultivation_type !== 'own' && (
                  <Alert type="info" showIcon style={{ marginTop: 12 }} title={tx('বর্গা/লিজ জমির বিল চাষির নামে হয়; মালিকদের নাম ইনভয়েসে সংরক্ষিত থাকে।')} />
                )}
              </>
            ) : null}
          </Card>
        </Col>
      </Row>
    </>
  )
}
