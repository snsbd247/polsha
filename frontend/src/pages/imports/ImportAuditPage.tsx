import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import { RollbackOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { useImportTypes } from '../../components/ImportWizard'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'

type Issue = { line: number; messages: string[] }
type Person = { name_bn: string; name_en?: string | null } | null
type Batch = {
  id: number
  type: string
  filename: string
  status: 'completed' | 'rollback_pending' | 'rolled_back'
  total_rows: number
  imported_rows: number
  skipped_rows: number
  total_amount: string | null
  errors: Issue[] | null
  mapping: Record<string, string> | null
  rollback_reason: string | null
  rolled_back_at: string | null
  rolled_back_by: Person | number
  approval_request: { id: number; status: string } | null
  created_at: string
  creator: Person
}
type BatchDetail = Batch & { blockers: string[] }

const STATUS: Record<Batch['status'], { label: string; color: string }> = {
  completed: { label: tx('সম্পন্ন'), color: 'green' },
  rollback_pending: { label: tx('রোলব্যাক অনুমোদনের অপেক্ষায়'), color: 'orange' },
  rolled_back: { label: tx('রোলব্যাক হয়েছে'), color: 'default' },
}

function BatchDrawer({ id, onClose, typeLabel }: { id: number | null; onClose: () => void; typeLabel: (t: string) => string }) {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<{ reason: string }>()
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const { data: b, isLoading } = useQuery({
    queryKey: ['import-batch', id],
    queryFn: async () => (await api.get<BatchDetail>(`/imports/${id}`)).data,
    enabled: !!id,
  })

  const submit = async ({ reason }: { reason: string }) => {
    setSaving(true)
    try {
      await api.post(`/imports/${id}/rollback`, { reason })
      message.success(tx('রোলব্যাকের আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।'))
      setAsking(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['import-batch', id] })
      queryClient.invalidateQueries({ queryKey: ['imports'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const by = b && typeof b.rolled_back_by === 'object' ? nameOf(b.rolled_back_by) : ''

  return (
    <Drawer open={!!id} onClose={onClose} size={720} title={tx('ব্যাচ #{{p0}}', { p0: digits(id ?? '') })}>
      {isLoading || !b ? (
        <Spin />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
            <Descriptions.Item label={tx('ধরন')}>{typeLabel(b.type)}</Descriptions.Item>
            <Descriptions.Item label={tx('অবস্থা')}>
              <Tag color={STATUS[b.status].color}>{STATUS[b.status].label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={tx('ফাইল')}>{b.filename}</Descriptions.Item>
            <Descriptions.Item label={tx('কে, কখন')}>{`${nameOf(b.creator)} · ${fmtDateTime(b.created_at)}`}</Descriptions.Item>
            <Descriptions.Item label={tx('সারি')}>
              {tx('মোট {{p0}} · Import {{p1}} · বাদ {{p2}}', { p0: digits(b.total_rows), p1: digits(b.imported_rows), p2: digits(b.skipped_rows) })}
            </Descriptions.Item>
            <Descriptions.Item label={tx('মোট টাকা')}>{b.total_amount !== null ? `৳${money(b.total_amount)}` : '—'}</Descriptions.Item>
            {b.rollback_reason && <Descriptions.Item label={tx('রোলব্যাকের কারণ')} span={2}>{b.rollback_reason}</Descriptions.Item>}
            {b.rolled_back_at && (
              <Descriptions.Item label={tx('রোলব্যাক')} span={2}>
                {`${by ?? ''} · ${fmtDateTime(b.rolled_back_at)}`}
              </Descriptions.Item>
            )}
            {b.approval_request && (
              <Descriptions.Item label={tx('অনুমোদন')} span={2}>
                <Link to={`/approvals/${b.approval_request.id}`}>#{digits(b.approval_request.id)}</Link>
              </Descriptions.Item>
            )}
          </Descriptions>

          {b.mapping && (
            <Typography.Text type="secondary">
              {tx('কলাম মেলানো')}:{' '}
              {Object.entries(b.mapping)
                .map(([k, v]) => `${k} ← ${v}`)
                .join(' · ')}
            </Typography.Text>
          )}

          {b.status === 'completed' && b.imported_rows > 0 && (
            <Card size="small" title={tx('রোলব্যাক')}>
              {b.blockers.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  title={tx('এই ব্যাচ রোলব্যাক করা যাবে না — পরে লেনদেন হয়েছে:')}
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {b.blockers.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  }
                />
              ) : (
                <Space orientation="vertical">
                  <Typography.Text>{tx('এই ব্যাচের পরে কোনো লেনদেন হয়নি — অনুমোদন সাপেক্ষে পুরো ব্যাচ ফিরিয়ে নেওয়া যাবে (হিসাবের এন্ট্রি রিভার্স হবে)।')}</Typography.Text>
                  {can('import.admin') && (
                    <Button danger icon={<RollbackOutlined />} onClick={() => setAsking(true)}>
                      {tx('রোলব্যাকের আবেদন')}
                    </Button>
                  )}
                </Space>
              )}
            </Card>
          )}

          <Typography.Title level={5}>{tx('বাদ পড়া সারি')}</Typography.Title>
          <Table
            rowKey="line"
            size="small"
            dataSource={b.errors ?? []}
            locale={{ emptyText: tx('কোনো সারি বাদ পড়েনি') }}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            columns={[
              { title: tx('সারি'), dataIndex: 'line', width: 70, render: digits },
              { title: tx('কারণ'), dataIndex: 'messages', render: (m: string[]) => m.map((x, i) => <div key={i}>{x}</div>) },
            ]}
          />
        </Space>
      )}
      <Modal open={asking} title={tx('রোলব্যাকের আবেদন')} okText={tx('আবেদন পাঠান')} okButtonProps={{ danger: true, loading: saving }} onOk={() => form.submit()} onCancel={() => setAsking(false)}>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  )
}

export default function ImportAuditPage() {
  const [search, setSearch] = useSearchParams()
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const type = search.get('type') ?? undefined
  const status = search.get('status') ?? undefined
  const openId = search.get('batch') ? Number(search.get('batch')) : null
  const { data: meta } = useImportTypes()
  const typeLabel = (t: string) => meta?.types.find((x) => x.key === t)?.label ?? t

  const setParam = (k: string, v?: string | number | null) => {
    const next = new URLSearchParams(search)
    if (v === undefined || v === null || v === '') next.delete(k)
    else next.set(k, String(v))
    setSearch(next)
    if (k !== 'batch') setPage(1)
  }

  const params = { page, type, status, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }
  const { data, isFetching } = useQuery({
    queryKey: ['imports', params],
    queryFn: async () => (await api.get<Paginated<Batch>>('/imports', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('ইমপোর্ট অডিট')}</h2>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select allowClear placeholder={tx('ধরন')} style={{ width: 200 }} value={type} options={meta?.types.map((t) => ({ value: t.key, label: t.label }))} onChange={(v) => setParam('type', v)} />
          <Select
            allowClear
            placeholder={tx('অবস্থা')}
            style={{ width: 220 }}
            value={status}
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))}
            onChange={(v) => setParam('status', v)}
          />
          <DatePicker.RangePicker value={range} onChange={(v) => (setRange(v), setPage(1))} />
        </Space>
      </Card>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Batch>
          rowKey="id"
          size="small"
          loading={isFetching}
          dataSource={data?.data}
          scroll={{ x: 900 }}
          onRow={(b) => ({ onClick: () => setParam('batch', b.id), style: { cursor: 'pointer' } })}
          pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          columns={[
            { title: tx('ব্যাচ'), dataIndex: 'id', render: (v) => `#${digits(v)}` },
            { title: tx('ধরন'), dataIndex: 'type', render: typeLabel },
            { title: tx('ফাইল'), dataIndex: 'filename', ellipsis: true },
            { title: 'Import', dataIndex: 'imported_rows', render: (v) => <Tag color="green">{digits(v)}</Tag> },
            { title: tx('বাদ'), dataIndex: 'skipped_rows', render: (v) => (v ? <Tag color="orange">{digits(v)}</Tag> : '—') },
            { title: tx('টাকা'), dataIndex: 'total_amount', align: 'right', render: (v) => (v !== null ? money(v) : '—') },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (s: Batch['status']) => <Tag color={STATUS[s]?.color} style={{ whiteSpace: 'normal' }}>{STATUS[s]?.label ?? s}</Tag> },
            { title: tx('কে, কখন'), render: (_, b) => `${nameOf(b.creator)} · ${fmtDateTime(b.created_at)}` },
          ]}
        />
      </Card>
      <BatchDrawer id={openId} onClose={() => setParam('batch', null)} typeLabel={typeLabel} />
    </>
  )
}
