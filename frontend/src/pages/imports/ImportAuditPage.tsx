import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Form, Grid, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, CloudUploadOutlined, EyeFilled, RollbackOutlined, WarningFilled } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { useImportTypes } from '../../components/ImportWizard'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDateTime } from '../../lib/format'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../accounting/accounting.css'

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
            <Descriptions.Item label={tx('সারি')}>{tx('মোট {{p0}} · Import {{p1}} · বাদ {{p2}}', { p0: digits(b.total_rows), p1: digits(b.imported_rows), p2: digits(b.skipped_rows) })}</Descriptions.Item>
            <Descriptions.Item label={tx('মোট টাকা')}>{b.total_amount !== null ? `৳${money(b.total_amount)}` : '—'}</Descriptions.Item>
            {b.rollback_reason && (
              <Descriptions.Item label={tx('রোলব্যাকের কারণ')} span={2}>
                {b.rollback_reason}
              </Descriptions.Item>
            )}
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

const STATUS_TONE: Record<Batch['status'], string> = { completed: 'fl-tag-green', rollback_pending: 'fl-tag-gold', rolled_back: 'll-gray' }
type Resp = Paginated<Batch> & { counts: { total: number; imported_rows: number; skipped_rows: number; rollback_pending: number } }
type Filters = { type?: string; status?: string; from?: string; to?: string }

/** Every import batch: what came in, what was skipped and why, and the rollback request. */
export default function ImportAuditPage() {
  const navigate = useNavigate()
  const wide = Grid.useBreakpoint().lg
  const [search, setSearch] = useSearchParams()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({ type: search.get('type') ?? undefined, status: search.get('status') ?? undefined })
  const [filters, setFilters] = useState<Filters>(draft)
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const openId = search.get('batch') ? Number(search.get('batch')) : null
  const { data: meta } = useImportTypes()
  const typeLabel = (t: string) => meta?.types.find((x) => x.key === t)?.label ?? t

  const setBatch = (v: number | null) => {
    const next = new URLSearchParams(search)
    if (v === null) next.delete('batch')
    else next.set('batch', String(v))
    setSearch(next)
  }
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({})
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['imports', params],
    queryFn: async () => (await api.get<Resp>('/imports', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0

  const cards = [
    { key: 'total', label: tx('মোট ব্যাচ'), value: c?.total, icon: '', glyph: <CloudUploadOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'rows', label: tx('ইমপোর্ট হওয়া সারি'), value: c?.imported_rows, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'completed' }) },
    { key: 'skipped', label: tx('বাদ পড়া সারি'), value: c?.skipped_rows, icon: '', glyph: <WarningFilled />, color: '#f08c00', tint: '#fdefd6' },
    { key: 'pending', label: tx('রোলব্যাক অনুমোদনের অপেক্ষায়'), value: c?.rollback_pending, icon: '', glyph: <RollbackOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'rollback_pending' }) },
  ]

  const columns: ColumnsType<Batch> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('ব্যাচ'),
      dataIndex: 'id',
      render: (v: number) => (
        <a className="fl-link iv-no" onClick={() => setBatch(v)}>
          #{digits(v)}
        </a>
      ),
    },
    { title: tx('ধরন'), dataIndex: 'type', render: (t: string) => <Tag className="fl-tag ll-purple">{typeLabel(t)}</Tag> },
    { title: tx('ফাইল'), dataIndex: 'filename', render: (v: string) => <span className="jl-narr">{v}</span> },
    { title: tx('ইমপোর্ট'), dataIndex: 'imported_rows', align: 'center', render: (v: number) => <Tag className="fl-tag fl-tag-green">{digits(v)}</Tag> },
    { title: tx('বাদ'), dataIndex: 'skipped_rows', align: 'center', render: (v: number) => (v ? <Tag className="fl-tag ll-orange">{digits(v)}</Tag> : '—') },
    { title: tx('টাকা (৳)'), dataIndex: 'total_amount', align: 'right', render: (v: string | null) => (v !== null ? money(v) : '—') },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: Batch['status']) => <Tag className={`fl-tag iv-status ${STATUS_TONE[s] ?? 'll-gray'}`}>{STATUS[s]?.label ?? s}</Tag> },
    {
      title: tx('কে, কখন'),
      render: (_, b) => (
        <span className="hs-two">
          <span className="mg-name">{nameOf(b.creator) || '—'}</span>
          <span>{fmtDateTime(b.created_at)}</span>
        </span>
      ),
    },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, b) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setBatch(b.id)} />,
    },
  ]
  const all = [{ value: '', label: tx('সকল') }]

  return (
    <ListFrame
      section={{ label: tx('টুলস ও ইমপোর্ট'), to: '/imports/audit' }}
      title={tx('ইমপোর্ট অডিট')}
      subtitle=""
      actions={
        <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => navigate('/imports?type=farmers')}>
          {tx('নতুন ইমপোর্ট')}
        </Button>
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('ধরন')} grow={220}>
            <Select value={draft.type ?? ''} options={[...all, ...(meta?.types ?? []).map((t) => ({ value: t.key, label: t.label }))]} onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')} grow={220}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))} />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('ব্যাচের তালিকা'), p1: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Batch>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('এখনও কোনো ইমপোর্ট হয়নি') }}
      />
      <BatchDrawer id={openId} onClose={() => setBatch(null)} typeLabel={typeLabel} />
    </ListFrame>
  )
}
