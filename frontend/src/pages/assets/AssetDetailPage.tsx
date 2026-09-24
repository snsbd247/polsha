import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Statistic, Table, Tabs, Tag } from 'antd'
import { EditOutlined, ToolOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import QrLabel from '../../components/QrLabel'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL } from '../../lib/irrigation'
import { toOptions } from '../../lib/phase2'
import { ASSET_STATUS_COLOR, CONDITION_COLOR, MAINT_STATUS_COLOR, useAssetFunds, useAssetMeta } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import type { AssetRow } from './AssetListPage'

type JournalRef = { id: number; voucher_no: string } | null
type Person = { id: number; name_bn: string; name_en: string | null } | null
export type Movement = {
  id: number
  type: string
  date: string
  from_location: string | null
  to_location: string | null
  custodian: string | null
  condition: string | null
  amount: string | null
  note: string | null
  journal: JournalRef
  creator: Person
}
export type Maintenance = {
  id: number
  asset_id: number
  kind: string
  title: string
  due_on: string | null
  repeat_months: number | null
  done_on: string | null
  cost: string | null
  vendor: string | null
  status: string
  note: string | null
  journal: JournalRef
}
type Depreciation = { id: number; period: string; amount: string; accumulated_after: string; book_value_after: string; journal: JournalRef }
type Detail = AssetRow & {
  supplier: string | null
  remarks: string | null
  reference: string | null
  method: string | null
  depreciation_from: string
  fund: { id: number; code: string; name_bn: string; name_en: string | null } | null
  journal: JournalRef
  creator: Person
  disposal: { type: string; date: string; price: number; reason: string; buyer: string | null } | null
  movements: Movement[]
  maintenances: Maintenance[]
  depreciations: Depreciation[]
  monthly_charge: number
  remaining: number
  months_left: number
}

type MoveType = 'transfer' | 'install' | 'uninstall' | 'condition' | 'repair' | 'repaired'
const LIVE = ['in_stock', 'installed', 'in_repair']
const ALLOWED: Record<MoveType, string[]> = {
  transfer: LIVE,
  install: ['in_stock'],
  uninstall: ['installed'],
  condition: LIVE,
  repair: ['in_stock', 'installed'],
  repaired: ['in_repair'],
}
const MOVE_LABEL: Record<MoveType, string> = {
  transfer: tx('স্থানান্তর'),
  install: tx('স্থাপন'),
  uninstall: tx('স্টকে ফেরত'),
  condition: tx('অবস্থা পরিবর্তন'),
  repair: tx('মেরামতে পাঠান'),
  repaired: tx('মেরামত শেষ'),
}

export const journalLink = (j: JournalRef, canView: boolean) => (j ? canView ? <Link to={`/accounting/journals/${j.id}`}>{digits(j.voucher_no)}</Link> : digits(j.voucher_no) : null)

export default function AssetDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useAssetMeta()
  const [move, setMove] = useState<MoveType | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [completing, setCompleting] = useState<Maintenance | null>(null)
  const [disposing, setDisposing] = useState(false)
  const { message } = App.useApp()
  const { data: a, isLoading } = useQuery({ queryKey: ['asset', id], queryFn: async () => (await api.get<Detail>(`/assets/${id}`)).data })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['asset', id] })
    queryClient.invalidateQueries({ queryKey: ['assets'] })
    queryClient.invalidateQueries({ queryKey: ['asset-maintenances'] })
    queryClient.invalidateQueries({ queryKey: ['asset-movements'] })
    queryClient.invalidateQueries({ queryKey: ['asset-dashboard'] })
  }
  const cancelJob = async (m: Maintenance) => {
    try {
      await api.post(`/assets/maintenances/${m.id}/cancel`)
      message.success(tx('বাতিল হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (isLoading || !a) return <Spin style={{ display: 'block', marginTop: 64 }} />
  const live = LIVE.includes(a.status)
  const canJournal = can('accounting.view')

  return (
    <>
      <div className="page-header">
        <h2>
          {digits(a.asset_code)} — {nameOf(a)} <Tag color={ASSET_STATUS_COLOR[a.status]}>{meta.data?.statuses[a.status] ?? a.status}</Tag>
        </h2>
        <Space wrap>
          <Can perm="asset.edit">
            {live &&
              (Object.keys(ALLOWED) as MoveType[])
                .filter((t) => ALLOWED[t].includes(a.status))
                .map((t) => (
                  <Button key={t} onClick={() => setMove(t)}>
                    {MOVE_LABEL[t]}
                  </Button>
                ))}
            {live && (
              <Button icon={<ToolOutlined />} onClick={() => setScheduling(true)}>
                {tx('সার্ভিস/মেরামত নির্ধারণ')}
              </Button>
            )}
            {live && (
              <Button danger onClick={() => setDisposing(true)}>
                {tx('বিক্রয় / বাতিল')}
              </Button>
            )}
            <Link to={`/assets/${a.id}/edit`}>
              <Button icon={<EditOutlined />}>{tx('সম্পাদনা')}</Button>
            </Link>
          </Can>
        </Space>
      </div>
      {a.status === 'disposal_pending' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={tx('বিক্রয়/বাতিলের আবেদন অনুমোদনের অপেক্ষায় আছে। অনুমোদন তালিকা থেকে সিদ্ধান্ত দিন।')} />}
      {a.disposal && a.status !== 'disposal_pending' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={tx('{{p0}} — {{p1}}, মূল্য ৳{{p2}}। কারণ: {{p3}}', {
            p0: meta.data?.statuses[a.status] ?? a.status,
            p1: fmtDate(a.disposal.date),
            p2: money(a.disposal.price),
            p3: a.disposal.reason,
          })}
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('ক্রয়মূল্য')} value={money(a.cost)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('পুঞ্জীভূত অবচয়')} value={money(a.accumulated_depreciation)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বর্তমান মূল্য')} value={money(a.book_value)} prefix="৳" styles={{ content: { color: '#1677ff' } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('মাসিক অবচয়')} value={money(a.monthly_charge)} prefix="৳" suffix={live ? <small>{tx('(বাকি {{p0}} মাস)', { p0: digits(a.months_left) })}</small> : null} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={17}>
          <Card>
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label={tx('শ্রেণি')}>{nameOf(a.category)}</Descriptions.Item>
              <Descriptions.Item label={tx('অর্জনের ধরন')}>{meta.data?.acquisitions[a.acquisition] ?? a.acquisition}</Descriptions.Item>
              <Descriptions.Item label={tx('ব্র্যান্ড / মডেল')}>{a.brand_model}</Descriptions.Item>
              <Descriptions.Item label={tx('সিরিয়াল নম্বর')}>{digits(a.serial_no)}</Descriptions.Item>
              <Descriptions.Item label={tx('সরবরাহকারী')}>{a.supplier}</Descriptions.Item>
              <Descriptions.Item label={tx('ক্রয়ের তারিখ')}>{fmtDate(a.purchase_date)}</Descriptions.Item>
              <Descriptions.Item label={tx('অবশিষ্ট মূল্য')}>৳{money(a.salvage_value)}</Descriptions.Item>
              <Descriptions.Item label={tx('আয়ুষ্কাল (মাস)')}>{digits(a.life_months)}</Descriptions.Item>
              <Descriptions.Item label={tx('অবচয় শুরু')}>{fmtDate(a.depreciation_from)}</Descriptions.Item>
              <Descriptions.Item label={tx('পরিশোধ')}>
                {a.method ? (METHOD_LABEL[a.method] ?? (a.method === 'credit' ? tx('বাকিতে') : a.method)) : ''}
                {a.fund ? ` — ${accountLabel(a.fund)}` : ''}
                {a.reference ? ` (${digits(a.reference)})` : ''}
              </Descriptions.Item>
              <Descriptions.Item label={tx('অবস্থান')}>{a.location ?? ''}{a.mouza ? ` (${nameOf(a.mouza)})` : ''}</Descriptions.Item>
              <Descriptions.Item label={tx('দায়িত্বপ্রাপ্ত')}>{a.custodian}</Descriptions.Item>
              <Descriptions.Item label={tx('অবস্থা')}>{a.condition && <Tag color={CONDITION_COLOR[a.condition]}>{meta.data?.conditions[a.condition] ?? a.condition}</Tag>}</Descriptions.Item>
              <Descriptions.Item label={tx('স্থাপনের তারিখ')}>{fmtDate(a.installed_on)}</Descriptions.Item>
              <Descriptions.Item label={tx('ভাউচার')}>{journalLink(a.journal, canJournal)}</Descriptions.Item>
              <Descriptions.Item label={tx('এন্ট্রি করেছেন')}>{nameOf(a.creator)}</Descriptions.Item>
              <Descriptions.Item label={tx('মন্তব্য')} span={2}>
                {a.remarks}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <QrLabel type="asset" code={a.asset_code} title={nameOf(a)} subtitle={a.asset_code} />
        </Col>
      </Row>
      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={[
            {
              key: 'movements',
              label: tx('চলাচলের ইতিহাস ({{p0}})', { p0: digits(a.movements.length) }),
              children: <MovementTable rows={a.movements} types={meta.data?.movement_types} conditions={meta.data?.conditions} canJournal={canJournal} />,
            },
            {
              key: 'maintenance',
              label: tx('সার্ভিস ও মেরামত ({{p0}})', { p0: digits(a.maintenances.length) }),
              children: (
                <Table<Maintenance>
                  rowKey="id"
                  size="small"
                  dataSource={a.maintenances}
                  pagination={false}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: tx('ধরন'), dataIndex: 'kind', render: (v: string) => meta.data?.maintenance_kinds[v] ?? v },
                    { title: tx('কাজ'), dataIndex: 'title' },
                    { title: tx('নির্ধারিত তারিখ'), dataIndex: 'due_on', render: fmtDate },
                    { title: tx('সম্পন্ন'), dataIndex: 'done_on', render: fmtDate },
                    { title: tx('খরচ'), dataIndex: 'cost', align: 'right', render: moneyOrBlank },
                    { title: tx('ভাউচার'), render: (_, m) => journalLink(m.journal, canJournal) },
                    { title: tx('স্ট্যাটাস'), dataIndex: 'status', render: (v: string) => <Tag color={MAINT_STATUS_COLOR[v]}>{meta.data?.maintenance_statuses[v] ?? v}</Tag> },
                    {
                      title: '',
                      render: (_, m) =>
                        m.status === 'scheduled' && can('asset.edit') ? (
                          <Space>
                            <Button size="small" type="primary" onClick={() => setCompleting(m)}>
                              {tx('সম্পন্ন')}
                            </Button>
                            <Popconfirm title={tx('এই কাজ বাতিল করবেন?')} onConfirm={() => cancelJob(m)}>
                              <Button size="small">{tx('বাতিল')}</Button>
                            </Popconfirm>
                          </Space>
                        ) : null,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'depreciation',
              label: tx('অবচয় ({{p0}})', { p0: digits(a.depreciations.length) }),
              children: (
                <Table<Depreciation>
                  rowKey="id"
                  size="small"
                  dataSource={a.depreciations}
                  pagination={{ pageSize: 12 }}
                  columns={[
                    { title: tx('মাস'), dataIndex: 'period', render: (v: string) => digits(v) },
                    { title: tx('অবচয়'), dataIndex: 'amount', align: 'right', render: money },
                    { title: tx('পুঞ্জীভূত'), dataIndex: 'accumulated_after', align: 'right', render: money },
                    { title: tx('বর্তমান মূল্য'), dataIndex: 'book_value_after', align: 'right', render: money },
                    { title: tx('ভাউচার'), render: (_, d) => journalLink(d.journal, canJournal) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
      <MovementModal asset={a} type={move} onClose={() => setMove(null)} onDone={refresh} />
      <ScheduleModal asset={a} open={scheduling} onClose={() => setScheduling(false)} onDone={refresh} />
      <CompleteModal job={completing} onClose={() => setCompleting(null)} onDone={refresh} />
      <DisposeModal asset={a} open={disposing} onClose={() => setDisposing(false)} onDone={refresh} />
    </>
  )
}

export function MovementTable({ rows, types, conditions, canJournal, withAsset }: { rows: (Movement & { asset?: AssetRow })[]; types?: Record<string, string>; conditions?: Record<string, string>; canJournal: boolean; withAsset?: boolean }) {
  return (
    <Table<Movement & { asset?: AssetRow }>
      rowKey="id"
      size="small"
      dataSource={rows}
      pagination={withAsset ? false : { pageSize: 15 }}
      scroll={{ x: 900 }}
      columns={[
        { title: tx('তারিখ'), dataIndex: 'date', width: 110, render: fmtDate },
        ...(withAsset
          ? [
              {
                title: tx('সম্পদ'),
                render: (_: unknown, m: Movement & { asset?: AssetRow }) =>
                  m.asset ? (
                    <Link to={`/assets/${m.asset.id}`}>
                      {digits(m.asset.asset_code)} — {nameOf(m.asset)}
                    </Link>
                  ) : null,
              },
            ]
          : []),
        { title: tx('ধরন'), dataIndex: 'type', render: (v: string) => types?.[v] ?? v },
        { title: tx('থেকে'), dataIndex: 'from_location' },
        { title: tx('যেখানে'), dataIndex: 'to_location' },
        { title: tx('দায়িত্বপ্রাপ্ত'), dataIndex: 'custodian' },
        { title: tx('অবস্থা'), dataIndex: 'condition', render: (v: string | null) => (v ? (conditions?.[v] ?? v) : null) },
        { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: moneyOrBlank },
        { title: tx('নোট'), dataIndex: 'note' },
        { title: tx('ভাউচার'), render: (_, m) => journalLink(m.journal, canJournal) },
        { title: tx('করেছেন'), render: (_, m) => nameOf(m.creator) },
      ]}
    />
  )
}

type ModalProps = { asset: Detail; onClose: () => void; onDone: () => void }

function MovementModal({ asset, type, onClose, onDone }: ModalProps & { type: MoveType | null }) {
  const { message } = App.useApp()
  const meta = useAssetMeta()
  const [form] = Form.useForm()
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/movements`, { ...v, type, date: (v.date as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={!!type} forceRender destroyOnHidden title={type ? MOVE_LABEL[type] : ''} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs() }}>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        {(type === 'transfer' || type === 'install' || type === 'uninstall') && (
          <Form.Item
            name="to_location"
            label={tx('নতুন অবস্থান')}
            rules={type === 'transfer' ? [required(tx('অবস্থান লিখুন'))] : []}
            extra={tx('বর্তমান: {{p0}}', { p0: asset.location ?? '—' })}
          >
            <Input maxLength={200} />
          </Form.Item>
        )}
        {type !== 'condition' && (
          <Form.Item name="custodian" label={tx('দায়িত্বপ্রাপ্ত')} extra={tx('বর্তমান: {{p0}}', { p0: asset.custodian ?? '—' })}>
            <Input maxLength={150} />
          </Form.Item>
        )}
        {(type === 'condition' || type === 'repaired') && (
          <Form.Item name="condition" label={tx('অবস্থা')} rules={type === 'condition' ? [required(tx('অবস্থা বাছাই করুন'))] : []}>
            <Select options={toOptions(meta.data?.conditions)} />
          </Form.Item>
        )}
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ScheduleModal({ asset, open, onClose, onDone }: ModalProps & { open: boolean }) {
  const { message } = App.useApp()
  const meta = useAssetMeta()
  const [form] = Form.useForm()
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/maintenances`, { ...v, due_on: (v.due_on as Dayjs | undefined)?.format('YYYY-MM-DD') })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} forceRender title={tx('সার্ভিস/মেরামত নির্ধারণ')} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'service' }}>
        <Form.Item name="kind" label={tx('ধরন')}>
          <Select options={toOptions(meta.data?.maintenance_kinds)} />
        </Form.Item>
        <Form.Item name="title" label={tx('কাজ')} rules={[required(tx('কাজের বিবরণ লিখুন'))]}>
          <Input maxLength={200} placeholder={tx('যেমন: মোটর সার্ভিসিং')} />
        </Form.Item>
        <Form.Item name="due_on" label={tx('নির্ধারিত তারিখ')}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="repeat_months" label={tx('পুনরাবৃত্তি (মাস পর পর)')} extra={tx('সম্পন্ন হলে পরের কাজ স্বয়ংক্রিয়ভাবে নির্ধারিত হবে।')}>
          <InputNumber min={1} max={120} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const PAY_METHODS: Record<string, string> = { ...METHOD_LABEL, credit: tx('বাকিতে') }

export function CompleteModal({ job, onClose, onDone }: { job: Maintenance | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp()
  const funds = useAssetFunds()
  const [form] = Form.useForm()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const cost: number | undefined = Form.useWatch('cost', form)
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v || !job) return
    try {
      await api.post(`/assets/maintenances/${job.id}/complete`, {
        ...v,
        done_on: (v.done_on as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method !== 'cash' && v.method !== 'credit' ? v.fund_account_id : null,
      })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={!!job} forceRender title={tx('কাজ সম্পন্ন — {{p0}}', { p0: job?.title ?? '' })} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ done_on: dayjs(), method: 'cash' }}>
        <Form.Item name="done_on" label={tx('সম্পন্নের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="cost" label={tx('খরচ')} extra={tx('খরচ দিলে মেরামত খরচের ভাউচার হবে।')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" />
        </Form.Item>
        {!!cost && (
          <>
            <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')}>
              <Select options={toOptions(PAY_METHODS)} />
            </Form.Item>
            {method !== 'cash' && method !== 'credit' && (
              <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                <Select
                  loading={funds.isFetching}
                  options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((f) => ({ value: f.id, label: accountLabel(f) }))}
                />
              </Form.Item>
            )}
            {method !== 'cash' && (
              <Form.Item name="reference" label={tx('রেফারেন্স')}>
                <Input maxLength={100} />
              </Form.Item>
            )}
          </>
        )}
        <Form.Item name="vendor" label={tx('মেকানিক / প্রতিষ্ঠান')}>
          <Input maxLength={150} />
        </Form.Item>
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function DisposeModal({ asset, open, onClose, onDone }: ModalProps & { open: boolean }) {
  const { message } = App.useApp()
  const funds = useAssetFunds()
  const [form] = Form.useForm()
  const type: string = Form.useWatch('type', form) ?? 'sale'
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const price: number = Form.useWatch('price', form) ?? 0
  const gain = price - asset.book_value
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/dispose`, {
        ...v,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.type === 'sale' && v.method !== 'cash' ? v.fund_account_id : null,
      })
      message.success(tx('অনুমোদনের জন্য পাঠানো হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} forceRender title={tx('সম্পদ বিক্রয় / বাতিল')} onCancel={onClose} onOk={save} okText={tx('অনুমোদনে পাঠান')} cancelText={tx('বাতিল')}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('বর্তমান মূল্য ৳{{p0}}। অনুমোদনের পর সম্পদ হিসাব থেকে বাদ যাবে এবং লাভ/ক্ষতির ভাউচার হবে।', { p0: money(asset.book_value) })} />
      <Form form={form} layout="vertical" initialValues={{ type: 'sale', date: dayjs(), method: 'cash' }}>
        <Form.Item name="type" label={tx('ধরন')}>
          <Select
            options={[
              { value: 'sale', label: tx('বিক্রয়') },
              { value: 'writeoff', label: tx('বাতিল (অকেজো)') },
            ]}
          />
        </Form.Item>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        {type === 'sale' && (
          <>
            <Form.Item
              name="price"
              label={tx('বিক্রয়মূল্য')}
              rules={[required(tx('বিক্রয়মূল্য দিন'))]}
              extra={price ? (gain >= 0 ? tx('লাভ: ৳{{p0}}', { p0: money(gain) }) : tx('ক্ষতি: ৳{{p0}}', { p0: money(-gain) })) : undefined}
            >
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="৳" />
            </Form.Item>
            <Form.Item name="buyer" label={tx('ক্রেতা')}>
              <Input maxLength={150} />
            </Form.Item>
            <Form.Item name="method" label={tx('মাধ্যম')}>
              <Select options={toOptions(METHOD_LABEL)} />
            </Form.Item>
            {method !== 'cash' && (
              <>
                <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                  <Select
                    loading={funds.isFetching}
                    options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((f) => ({ value: f.id, label: accountLabel(f) }))}
                  />
                </Form.Item>
                <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[required(tx('রেফারেন্স দিন'))]}>
                  <Input maxLength={100} />
                </Form.Item>
              </>
            )}
          </>
        )}
        <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
