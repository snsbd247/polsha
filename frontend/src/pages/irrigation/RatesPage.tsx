import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { RATE_STATUS_COLOR, useInvoiceMeta, type Season } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Current = {
  irrigation_type_id: number
  irrigation_type: string
  land_type_id: number | null
  land_type: string | null
  rate: number | null
  effective_from: string | null
  next_rate: number | null
  next_from: string | null
  changes: number
}
type User = { id: number; name_bn: string; name_en: string | null } | null
type History = {
  id: number
  irrigation_type_name: string
  land_type_name: string | null
  rate: string
  effective_from: string
  status: string
  reason: string | null
  created_at: string
  approval_request_id: number | null
  creator: User
  approver: User
}
type RatesResponse = { season: Season; current: Current[]; history: History[]; statuses: Record<string, string> }

const allLands = (v: string | null) => v || tx('সব ধরনের জমি')
const perDecimal = (v: number | string | null) => (v === null ? '—' : tx('৳{{p0}} / শতক', { p0: money(v) }))

export default function RatesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [proposing, setProposing] = useState(false)
  const [form] = Form.useForm()
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()

  const seasonId = Number(params.get('season_id')) || meta?.seasons.find((s) => s.status === 'open')?.id || meta?.seasons[0]?.id

  const { data, isLoading } = useQuery({
    queryKey: ['irrigation-rates', seasonId],
    queryFn: async () => (await api.get<RatesResponse>('/irrigation-rates', { params: { season_id: seasonId } })).data,
    enabled: !!seasonId,
  })

  const propose = (preset?: Partial<Current>) => {
    form.resetFields()
    const start = data?.season.start_date ? dayjs(data.season.start_date) : dayjs()
    form.setFieldsValue({
      irrigation_type_id: preset?.irrigation_type_id,
      land_type_id: preset?.land_type_id ?? undefined,
      rate: preset?.rate ?? undefined,
      effective_from: start.isAfter(dayjs()) ? start : dayjs(),
    })
    setProposing(true)
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      await api.post('/irrigation-rates', { ...v, season_id: seasonId, land_type_id: v.land_type_id ?? null, effective_from: (v.effective_from as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('রেট অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setProposing(false)
      queryClient.invalidateQueries({ queryKey: ['irrigation-rates'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('সেচের রেট')}</h2>
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={seasonId}
            placeholder={tx('মৌসুম')}
            options={meta?.seasons.map((s) => ({ value: s.id, label: s.name_bn }))}
            onChange={(v) => setParams({ season_id: String(v) })}
          />
          <Can perm="irrigation.edit">
            <Button type="primary" icon={<PlusOutlined />} disabled={!seasonId} onClick={() => propose()}>
              {tx('নতুন রেট প্রস্তাব')}
            </Button>
          </Can>
        </Space>
      </div>
      {!meta?.seasons.length && meta && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={<span>{tx('আগে একটি মৌসুম তৈরি করুন।')} <Link to="/irrigation/seasons">{tx('মৌসুম')}</Link></span>} />}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={tx('রেট প্রতি শতক হিসাবে। নতুন বা পরিবর্তিত রেট অনুমোদনের পরই কার্যকর হয়; আগের ইনভয়েসের রেট বদলায় না — পুরনো রেট ইতিহাসে থাকে।')}
      />

      <Card title={tx('বর্তমান রেট')} style={{ marginBottom: 16 }}>
        <Table<Current>
          rowKey={(r) => `${r.irrigation_type_id}-${r.land_type_id ?? 0}`}
          loading={isLoading}
          dataSource={data?.current}
          pagination={false}
          locale={{ emptyText: <Empty description={tx('এই মৌসুমে কোনো অনুমোদিত রেট নেই')} /> }}
          scroll={{ x: 700 }}
          columns={[
            { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type' },
            { title: tx('জমির ধরন'), dataIndex: 'land_type', render: allLands },
            { title: tx('রেট'), dataIndex: 'rate', render: (v) => <strong>{perDecimal(v)}</strong> },
            { title: tx('কার্যকর তারিখ'), dataIndex: 'effective_from', render: fmtDate },
            {
              title: tx('পরবর্তী রেট'),
              render: (_, r) => (r.next_rate !== null ? tx('{{p0}} — {{p1}} থেকে', { p0: perDecimal(r.next_rate), p1: fmtDate(r.next_from) }) : '—'),
            },
            { title: tx('পরিবর্তন'), dataIndex: 'changes', render: digits },
            {
              title: '',
              width: 120,
              render: (_, r) => (
                <Can perm="irrigation.edit">
                  <Button size="small" onClick={() => propose(r)}>
                    {tx('রেট বদলান')}
                  </Button>
                </Can>
              ),
            },
          ]}
        />
      </Card>

      <Card title={tx('রেটের ইতিহাস')}>
        <Table<History>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.history}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 1000 }}
          columns={[
            { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type_name' },
            { title: tx('জমির ধরন'), dataIndex: 'land_type_name', render: allLands },
            { title: tx('রেট'), dataIndex: 'rate', render: perDecimal },
            { title: tx('কার্যকর তারিখ'), dataIndex: 'effective_from', render: fmtDate },
            {
              title: tx('অবস্থা'),
              dataIndex: 'status',
              render: (v: string, r) => {
                const tag = <Tag color={RATE_STATUS_COLOR[v]}>{data?.statuses[v] ?? v}</Tag>
                return r.approval_request_id ? <Link to={`/approvals/${r.approval_request_id}`}>{tag}</Link> : tag
              },
            },
            { title: tx('কারণ'), dataIndex: 'reason', ellipsis: true },
            { title: tx('প্রস্তাবকারী'), render: (_, r) => nameOf(r.creator) },
            { title: tx('অনুমোদনকারী'), render: (_, r) => nameOf(r.approver) || '—' },
            { title: tx('প্রস্তাবের সময়'), dataIndex: 'created_at', render: fmtDateTime },
          ]}
        />
      </Card>

      <Modal open={proposing} forceRender title={tx('নতুন রেট প্রস্তাব — {{p0}}', { p0: data?.season.name_bn ?? '' })} onCancel={() => setProposing(false)} onOk={save} okText={tx('অনুমোদনে পাঠান')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="irrigation_type_id" label={tx('সেচের ধরন')} rules={[required(tx('সেচের ধরন বাছাই করুন'))]}>
            <Select options={meta?.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
          </Form.Item>
          <Form.Item name="land_type_id" label={tx('জমির ধরন')} extra={tx('খালি রাখলে এই সেচের ধরনের সব জমিতে প্রযোজ্য; নির্দিষ্ট জমির ধরনের রেট থাকলে সেটিই আগে ধরা হয়।')}>
            <Select allowClear placeholder={tx('সব ধরনের জমি')} options={landMeta?.land_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
          </Form.Item>
          <Form.Item name="rate" label={tx('রেট (প্রতি শতক, টাকা)')} rules={[required(tx('রেট দিন'))]}>
            <InputNumber min={0.01} step={0.5} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
          <Form.Item name="effective_from" label={tx('কার্যকর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label={tx('কারণ / সভার সিদ্ধান্ত')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
