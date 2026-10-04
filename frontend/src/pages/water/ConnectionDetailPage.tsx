import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Result, Row, Spin, Statistic, Table, Tabs, Tag } from 'antd'
import { DisconnectOutlined, DollarOutlined, EditOutlined, LinkOutlined, StopOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import { BILL_STATUS_COLOR, billLabel, useWaterMeta, type WaterBill, type WaterConnection } from '../../lib/water'
import PageFrame from '../../components/PageFrame'
import ConnectionForm from './ConnectionForm'

type Detail = WaterConnection & {
  fee: number
  due: number
  bills: WaterBill[]
  receipts: { id: number; receipt_no: string; date: string; amount: string; method: string; status: string }[]
  creator: { name_bn: string; name_en: string | null } | null
}
type Action = 'disconnect' | 'reconnect' | 'close'

export default function ConnectionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()
  const { data: meta } = useWaterMeta()
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['water', 'connection', id],
    queryFn: async () => (await api.get<Detail>(`/water/connections/${id}`)).data,
  })

  if (isLoading) return <Spin />
  if (error || !c) return <Result status="404" title={errorMessage(error)} />

  const changeStatus = async (v: { date: dayjs.Dayjs; reason?: string; fee?: number }) => {
    setBusy(true)
    try {
      await api.post(`/water/connections/${c.id}/status`, { action, date: v.date.format('YYYY-MM-DD'), reason: v.reason, fee: v.fee })
      message.success(tx('সংযোগের অবস্থা বদলানো হয়েছে।'))
      setAction(null)
      queryClient.invalidateQueries({ queryKey: ['water'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const openAction = (a: Action) => {
    form.resetFields()
    form.setFieldsValue({ date: dayjs(), fee: 0 })
    setAction(a)
  }
  const ACTION_TITLE: Record<Action, string> = {
    disconnect: tx('সংযোগ বিচ্ছিন্ন করুন'),
    reconnect: tx('আবার সংযোগ দিন'),
    close: tx('সংযোগ স্থায়ীভাবে বন্ধ করুন'),
  }

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('সংযোগ ও গ্রাহক'), to: '/water/connections' }, { label: digits(c.connection_no) }]}
      title={`${nameOf(c)} — ${digits(c.connection_no)}`}
      actions={
        <>
          {can('water.create') && c.due > 0 && (
            <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate(`/water/collect?connection=${c.id}`)}>
              {tx('আদায়')}
            </Button>
          )}
          {can('water.edit') && (
            <>
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {tx('সম্পাদনা')}
              </Button>
              {c.status === 'active' && (
                <Button danger icon={<DisconnectOutlined />} onClick={() => openAction('disconnect')}>
                  {tx('বিচ্ছিন্ন')}
                </Button>
              )}
              {c.status === 'disconnected' && (
                <Button icon={<LinkOutlined />} onClick={() => openAction('reconnect')}>
                  {tx('পুনঃসংযোগ')}
                </Button>
              )}
              {c.status !== 'closed' && (
                <Button icon={<StopOutlined />} onClick={() => openAction('close')}>
                  {tx('বন্ধ')}
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('অবস্থা')} value={meta?.statuses[c.status] ?? c.status} styles={{ content: { color: c.status === 'active' ? '#389e0d' : '#cf1322' } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('মাসিক ফি')} value={money(c.fee)} prefix="৳" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('বকেয়া বিল')} value={digits(c.bills.filter((b) => b.status === 'unpaid' || b.status === 'partial').length)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={tx('মোট বকেয়া')} value={money(c.due)} prefix="৳" styles={{ content: { color: c.due > 0 ? '#cf1322' : undefined } }} />
          </Card>
        </Col>
      </Row>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label={tx('গ্রাহক')}>
            {nameOf(c)}
            {c.farmer && (
              <>
                {' · '}
                <Link to={`/farmers/${c.farmer.id}`}>
                  {tx('কৃষক')} {digits(c.farmer.farmer_code)}
                </Link>
              </>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={tx('পিতা/স্বামী')}>{c.father_name || '—'}</Descriptions.Item>
          <Descriptions.Item label={tx('মোবাইল')}>{c.mobile ? digits(c.mobile) : '—'}</Descriptions.Item>
          <Descriptions.Item label={tx('গ্রাম / পাড়া')}>{[nameOf(c.village), c.address].filter(Boolean).join(', ') || '—'}</Descriptions.Item>
          <Descriptions.Item label={tx('সংযোগের ধরন')}>{nameOf(c.type)}</Descriptions.Item>
          <Descriptions.Item label={tx('সংযোগের তারিখ')}>{fmtDate(c.connected_on)}</Descriptions.Item>
          <Descriptions.Item label={tx('NID')}>{c.nid ? digits(c.nid) : '—'}</Descriptions.Item>
          {c.status !== 'active' && (
            <Descriptions.Item label={tx('অবস্থা বদলের কারণ')}>
              {c.status_reason || '—'} ({fmtDate(c.status_date)})
            </Descriptions.Item>
          )}
          {c.remarks && <Descriptions.Item label={tx('মন্তব্য')}>{c.remarks}</Descriptions.Item>}
        </Descriptions>
      </Card>
      <Tabs
        items={[
          {
            key: 'bills',
            label: tx('বিল ({{p0}})', { p0: digits(c.bills.length) }),
            children: (
              <Table<WaterBill>
                rowKey="id"
                size="small"
                dataSource={c.bills}
                pagination={{ pageSize: 12 }}
                scroll={{ x: 800 }}
                columns={[
                  { title: tx('বিল নং'), dataIndex: 'bill_no', width: 150, render: (v: string) => digits(v) },
                  { title: tx('কিসের বিল'), render: (_, b) => billLabel(b) },
                  { title: tx('তারিখ'), dataIndex: 'bill_date', width: 110, render: fmtDate },
                  { title: tx('বিল'), dataIndex: 'amount', width: 100, align: 'right', render: money },
                  { title: tx('জরিমানা'), dataIndex: 'penalty', width: 100, align: 'right', render: (v: number) => (v ? money(v) : '') },
                  { title: tx('আদায়'), dataIndex: 'paid_amount', width: 100, align: 'right', render: money },
                  { title: tx('বকেয়া'), dataIndex: 'due', width: 100, align: 'right', render: (v: number) => (v > 0 ? <strong style={{ color: '#cf1322' }}>{money(v)}</strong> : money(0)) },
                  { title: tx('অবস্থা'), dataIndex: 'status', width: 120, render: (s: string) => <Tag color={BILL_STATUS_COLOR[s]}>{meta?.bill_statuses[s] ?? s}</Tag> },
                ]}
              />
            ),
          },
          {
            key: 'receipts',
            label: tx('রশিদ ({{p0}})', { p0: digits(c.receipts.length) }),
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={c.receipts}
                pagination={{ pageSize: 12 }}
                columns={[
                  { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string, r) => <Link to={`/water/receipts/${r.id}`}>{digits(v)}</Link> },
                  { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                  { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
                  { title: tx('মাধ্যম'), dataIndex: 'method', render: (m: string) => meta?.methods[m] ?? m },
                  { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <Tag color={RECEIPT_STATUS_COLOR[s]}>{RECEIPT_STATUS_LABEL[s] ?? s}</Tag> },
                ]}
              />
            ),
          },
        ]}
      />

      <ConnectionForm open={editing} connection={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      <Modal open={!!action} title={action ? ACTION_TITLE[action] : ''} onCancel={() => setAction(null)} onOk={() => form.submit()} confirmLoading={busy} okText={tx('নিশ্চিত করুন')} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={changeStatus}>
          <Form.Item name="date" label={tx('তারিখ')} rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
          {action === 'reconnect' && (
            <Form.Item name="fee" label={tx('পুনঃসংযোগ ফি')} extra={tx('০ দিলে কোনো ফি-র বিল হবে না।')}>
              <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
            </Form.Item>
          )}
          <Form.Item name="reason" label={tx('কারণ')} rules={action === 'reconnect' ? [] : [{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
          {action === 'close' && <p style={{ color: '#888', margin: 0 }}>{tx('বকেয়া থাকলে সংযোগ বন্ধ করা যায় না। বন্ধ সংযোগে আর বিল হয় না।')}</p>}
          {action === 'disconnect' && <p style={{ color: '#888', margin: 0 }}>{tx('বিচ্ছিন্ন থাকা অবস্থায় মাসিক বিল হবে না; আগের বকেয়া থেকে যাবে।')}</p>}
        </Form>
      </Modal>
    </PageFrame>
  )
}
