import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Form, Row, Segmented, Select, Space, Spin, Statistic, Table, Tag } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { useInvoiceMeta, type Owner, type Person } from '../../lib/irrigation'
import { CULTIVATION_COLOR, fmtArea, useLandMeta } from '../../lib/land'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'

type Line = {
  land_id: number
  ok: boolean
  reason: string | null
  land_code: string
  mouza: string | null
  mouza_en: string | null
  dag_no: string
  khatian_no: string
  cultivator: Person | null
  owners: Owner[]
  cultivation_type: string | null
  land_type: string | null
  irrigation_type: string | null
  area_decimal: number
  rate: number | null
  amount: number
}
type Preview = {
  summary: {
    lands: number
    invoices: number
    farmers: number
    area: number
    amount: number
    by_cultivation: Record<string, { count: number; area: number; amount: number }>
    skipped: Record<string, number>
  }
  lines: Line[]
}
type Batch = { id: number; invoice_count: number; total_amount: number; skipped_count: number }

export default function BulkInvoicePage() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sent, setSent] = useState<Record<string, unknown> | null>(null)
  const [show, setShow] = useState<'ok' | 'skipped'>('ok')
  const [busy, setBusy] = useState(false)
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const values = async () => {
    const v = await form.validateFields()
    return { season_id: v.season_id, mouza_id: v.mouza_id ?? null, invoice_date: (v.invoice_date as Dayjs).format('YYYY-MM-DD') }
  }

  const runPreview = async () => {
    const body = await values()
    setBusy(true)
    try {
      setPreview((await api.post<Preview>('/invoices/bulk/preview', body)).data)
      setSent(body)
      setShow('ok')
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = () => {
    if (!preview || !sent) return
    modal.confirm({
      title: tx('{{p0}}টি ইনভয়েস তৈরি করবেন?', { p0: digits(preview.summary.invoices) }),
      content: tx('মোট ৳{{p0}}। প্রতিটি ইনভয়েসের হিসাব (পাওনা/আয়) সাথে সাথে খাতায় উঠবে।', { p0: money(preview.summary.amount) }),
      okText: tx('হ্যাঁ, তৈরি করুন'),
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const b = (await api.post<Batch>('/invoices/bulk', sent)).data
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
          queryClient.invalidateQueries({ queryKey: ['seasons'] })
          modal.success({
            title: tx('{{p0}}টি ইনভয়েস তৈরি হয়েছে', { p0: digits(b.invoice_count) }),
            content: tx('মোট ৳{{p0}}; বাদ পড়েছে {{p1}}টি জমি।', { p0: money(b.total_amount), p1: digits(b.skipped_count) }),
            onOk: () => navigate(`/irrigation/invoices?batch_id=${b.id}`),
          })
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })
  }

  if (!meta) return <Spin />
  const s = preview?.summary
  const skippedTotal = s ? Object.values(s.skipped).reduce((a, b) => a + b, 0) : 0
  const lines = preview?.lines.filter((l) => (show === 'ok' ? l.ok : !l.ok)) ?? []

  return (
    <>
      <div className="page-header">
        <h2>{tx('একসাথে সেচ ইনভয়েস')}</h2>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{ season_id: meta?.seasons.find((x) => x.status === 'open')?.id, invoice_date: dayjs() }} onValuesChange={() => setPreview(null)}>
          <Form.Item name="season_id" label={tx('মৌসুম')} rules={[required(tx('মৌসুম বাছাই করুন'))]}>
            <Select style={{ width: 200 }} options={meta?.seasons.map((x) => ({ value: x.id, label: x.name_bn, disabled: x.status === 'closed' }))} />
          </Form.Item>
          <Form.Item name="mouza_id" label={tx('মৌজা')}>
            <Select allowClear style={{ width: 200 }} placeholder={tx('সব মৌজা')} showSearch={{ optionFilterProp: 'label' }} options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))} />
          </Form.Item>
          <Form.Item name="invoice_date" label={tx('ইনভয়েসের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
            <DatePicker format="DD/MM/YYYY" disabledDate={(d) => d.isAfter(dayjs())} />
          </Form.Item>
          <Button type="primary" icon={<EyeOutlined />} loading={busy} onClick={runPreview}>
            {tx('প্রিভিউ')}
          </Button>
        </Form>
      </Card>

      {!s ? (
        <Alert
          type="info"
          showIcon
          title={tx('চাষাধীন, চাষি ও সেচের ধরন নির্ধারিত সব জমির জন্য অনুমোদিত রেটে ইনভয়েস হবে। আগে প্রিভিউ দেখে নিশ্চিত হোন; এই মৌসুমে আগে ইনভয়েস হওয়া জমি বাদ যাবে।')}
        />
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={tx('ইনভয়েস হবে')} value={digits(s.invoices)} suffix={tx('/ {{p0}} জমি', { p0: digits(s.lands) })} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={tx('চাষি')} value={digits(s.farmers)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={tx('মোট জমি')} value={fmtArea(s.area, landMeta)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={tx('মোট বিল')} value={money(s.amount)} prefix="৳" />
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Card size="small" title={tx('চাষের ধরন অনুযায়ী ভাগ')}>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="type"
                  dataSource={Object.entries(s.by_cultivation).map(([type, v]) => ({ type, ...v }))}
                  columns={[
                    { title: tx('ধরন'), dataIndex: 'type', render: (v: string) => <Tag color={CULTIVATION_COLOR[v]}>{meta?.cultivation_types[v] ?? v}</Tag> },
                    { title: tx('ইনভয়েস'), dataIndex: 'count', align: 'right', render: digits },
                    { title: tx('জমি'), dataIndex: 'area', align: 'right', render: (v) => fmtArea(v) },
                    { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title={tx('বাদ পড়বে ({{p0}}টি জমি)', { p0: digits(skippedTotal) })}>
                {skippedTotal === 0 ? (
                  <Alert type="success" showIcon title={tx('কোনো জমি বাদ পড়ছে না।')} />
                ) : (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="reason"
                    dataSource={Object.entries(s.skipped).map(([reason, count]) => ({ reason, count }))}
                    columns={[
                      { title: tx('কারণ'), dataIndex: 'reason', render: (v: string) => meta?.skip_reasons[v] ?? v },
                      { title: tx('জমি'), dataIndex: 'count', align: 'right', render: digits },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>
          <Card
            size="small"
            title={
              <Segmented
                value={show}
                onChange={(v) => setShow(v as 'ok' | 'skipped')}
                options={[
                  { value: 'ok', label: tx('ইনভয়েস হবে ({{p0}})', { p0: digits(s.invoices) }) },
                  { value: 'skipped', label: tx('বাদ পড়বে ({{p0}})', { p0: digits(skippedTotal) }) },
                ]}
              />
            }
            extra={
              <Space>
                <Button type="primary" disabled={!s.invoices} onClick={confirm}>
                  {tx('নিশ্চিত করে ইনভয়েস তৈরি করুন')}
                </Button>
              </Space>
            }
          >
            <Table<Line>
              rowKey="land_id"
              size="small"
              dataSource={lines}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              scroll={{ x: 1100 }}
              columns={[
                { title: 'Land ID', dataIndex: 'land_code', width: 120, render: (v, l) => <a href={`/lands/${l.land_id}`} target="_blank" rel="noreferrer">{v}</a> },
                { title: tx('মৌজা / দাগ'), render: (_, l) => `${nameOf({ name_bn: l.mouza, name_en: l.mouza_en })} / ${digits(l.dag_no)}` },
                { title: tx('চাষি'), render: (_, l) => (l.cultivator ? nameOf(l.cultivator) : '—') },
                { title: tx('চাষ'), dataIndex: 'cultivation_type', width: 90, render: (v: string | null) => v && <Tag color={CULTIVATION_COLOR[v]}>{meta?.cultivation_types[v] ?? v}</Tag> },
                { title: tx('মালিক'), render: (_, l) => l.owners.map((o) => nameOf(o)).join(', '), ellipsis: true },
                { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type', width: 130 },
                { title: tx('শতক'), dataIndex: 'area_decimal', width: 80, align: 'right', render: (v) => digits(Number(v)) },
                { title: tx('রেট'), dataIndex: 'rate', width: 80, align: 'right', render: (v) => (v === null ? '—' : digits(Number(v))) },
                show === 'ok'
                  ? { title: tx('টাকা'), dataIndex: 'amount', width: 110, align: 'right', render: money }
                  : { title: tx('কারণ'), dataIndex: 'reason', width: 200, render: (v: string) => <Tag color="orange">{meta?.skip_reasons[v] ?? v}</Tag> },
              ]}
            />
          </Card>
        </>
      )}
    </>
  )
}
