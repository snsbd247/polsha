import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, InputNumber, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, EditFilled, EyeFilled, FileTextFilled, InfoCircleFilled, PlusOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { RATE_STATE_TONE, useInvoiceMeta, type RatePage, type RateRow } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './rates.css'

type Filters = { search?: string; season_id?: number; irrigation_type_id?: number; land_type_id?: number; state?: string }

/**
 * Category rates: a rate per land type × irrigation source for each season.
 * New or changed rates are proposed from the panel and bill once approved.
 */
export default function CategoryRatesPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const openSeason = meta?.seasons.find((x) => x.status === 'open')?.id
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [editing, setEditing] = useState<RateRow | null>(null)
  const [saving, setSaving] = useState(false)
  const note: string | undefined = Form.useWatch('reason', form)
  // the panel starts on the running season once the seasons have loaded
  useEffect(() => {
    if (openSeason && !form.getFieldValue('season_id')) form.setFieldValue('season_id', openSeason)
  }, [openSeason, form])

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-rates', 'all', 'category', params],
    queryFn: async () => (await api.get<RatePage>('/irrigation-rates/all', { params })).data,
    placeholderData: keepPreviousData,
  })
  const s = data?.summary
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const canEdit = can('irrigation.edit')
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }
  const edit = (r: RateRow | null) => {
    setEditing(r)
    form.resetFields()
    form.setFieldsValue(
      r
        ? { season_id: r.season_id, irrigation_type_id: r.irrigation_type_id, land_type_id: r.land_type_id, rate: r.rate, effective_from: dayjs() }
        : { season_id: filters.season_id ?? openSeason, land_type_id: null, effective_from: dayjs() },
    )
  }
  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api.post('/irrigation-rates', {
        season_id: v.season_id,
        irrigation_type_id: v.irrigation_type_id,
        land_type_id: v.land_type_id ?? null,
        rate: v.rate,
        effective_from: (v.effective_from as Dayjs).format('YYYY-MM-DD'),
        reason: v.reason,
      })
      message.success(tx('রেট অনুমোদনের জন্য পাঠানো হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['irrigation-rates'] })
      edit(null)
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const cards = [
    { key: 'cats', label: tx('মোট ক্যাটাগরি'), value: s?.combinations, icon: 'layers', color: '#1769e0', tint: '#e4edfd', onClick: () => show({ state: 'active' }) },
    { key: 'active', label: tx('সক্রিয় রেট'), value: s?.active, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ state: 'active' }) },
    { key: 'expired', label: tx('মেয়াদোত্তীর্ণ রেট'), value: s?.expired, icon: '', solid: <ClockCircleOutlined />, color: '#6b7280', tint: '#eef0f4', onClick: () => show({ state: 'expired' }) },
    { key: 'total', label: tx('মোট রেট রেকর্ড'), value: s?.total, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
  ]

  const columns: ColumnsType<RateRow> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('ক্যাটাগরির নাম'), render: (_, r) => <span className="fl-name">{`${r.land_type} - ${r.irrigation_type ?? ''}`}</span> },
    { title: tx('মৌসুম'), dataIndex: 'season' },
    { title: tx('জমির ধরন'), dataIndex: 'land_type' },
    { title: tx('সেচের ধরন'), dataIndex: 'irrigation_type' },
    { title: tx('রেট (৳/শতক)'), dataIndex: 'rate', align: 'right', render: money },
    { title: tx('কার্যকর শুরু'), dataIndex: 'effective_from', render: fmtDate },
    { title: tx('কার্যকর শেষ'), dataIndex: 'effective_to', render: (v) => (v ? fmtDate(v) : '—') },
    { title: tx('অবস্থা'), dataIndex: 'state', align: 'center', render: (v: string) => <Tag className={`fl-tag rt-state ${RATE_STATE_TONE[v] ?? 'll-gray'}`}>{data?.states[v] ?? v}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 90,
      align: 'center',
      render: (_, r) => (
        <div className="mg-actions lt-actions">
          {canEdit && (
            <Tooltip title={tx('নতুন রেট প্রস্তাব')}>
              <Button type="text" className="mg-view" icon={<EditFilled />} onClick={() => edit(r)} />
            </Tooltip>
          )}
          {r.approval_request_id && (
            <Tooltip title={tx('অনুমোদন দেখুন')}>
              <Button type="text" className="mg-view" icon={<EyeFilled />} onClick={() => navigate(`/approvals/${r.approval_request_id}`)} />
            </Tooltip>
          )}
        </div>
      ),
    },
  ]

  const aside = canEdit && (
    <aside className="lt-panel">
      <header>
        <PlusOutlined />
        <h3>{editing ? tx('ক্যাটাগরি রেট পরিবর্তন') : tx('নতুন ক্যাটাগরি রেট')}</h3>
      </header>
      <Form form={form} layout="vertical" className="lt-form" initialValues={{ land_type_id: null, effective_from: dayjs() }}>
        <Form.Item label={tx('ক্যাটাগরির নাম')}>
          <Input disabled value={editing ? `${editing.land_type} - ${editing.irrigation_type ?? ''}` : tx('জমির ধরন ও সেচের ধরন থেকে')} />
        </Form.Item>
        <div className="rp-grid2 iv-grid">
          <Form.Item name="season_id" label={tx('মৌসুম')} rules={[{ required: true, message: tx('মৌসুম বাছাই করুন') }]}>
            <Select options={(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn, disabled: x.status === 'closed' }))} />
          </Form.Item>
          <Form.Item name="land_type_id" label={tx('জমির ধরন')}>
            <Select options={[{ value: null, label: tx('সব ধরনের জমি') }, ...(landMeta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} />
          </Form.Item>
        </div>
        <Form.Item name="irrigation_type_id" label={tx('সেচের ধরন')} rules={[{ required: true, message: tx('সেচের উৎস বাছাই করুন') }]}>
          <Select placeholder={tx('সেচের ধরন বাছাই করুন')} options={(meta?.irrigation_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))} />
        </Form.Item>
        <Form.Item name="rate" label={tx('রেট (৳/শতক)')} rules={[{ required: true, message: tx('রেট দিন') }]}>
          <InputNumber min={0.01} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="effective_from" label={tx('কার্যকর শুরু')} rules={[{ required: true, message: tx('তারিখ দিন') }]} extra={tx('মৌসুম শেষ বা পরের পরিবর্তন পর্যন্ত চলবে')}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="reason" label={tx('বিবরণ (ঐচ্ছিক)')} extra={<span className="iv-count">{tx('{{p0}}/৩০০ অক্ষর', { p0: digits(note?.length ?? 0) })}</span>}>
          <Input.TextArea rows={2} maxLength={300} placeholder={tx('বিবরণ লিখুন...')} />
        </Form.Item>
      </Form>
      <footer>
        <Button icon={<CloseOutlined />} onClick={() => edit(null)}>
          {tx('বাতিল')}
        </Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
          {tx('রেট সংরক্ষণ')}
        </Button>
      </footer>
    </aside>
  )

  return (
    <>
      <ListFrame
        section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
        title={tx('ক্যাটাগরিভিত্তিক রেট')}
        subtitle={tx('মৌসুম, জমির ধরন ও সেচের ধরন অনুযায়ী ক্যাটাগরিভিত্তিক সেচের রেট পরিচালনা করুন।')}
        actions={
          canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => edit(null)}>
              {tx('নতুন ক্যাটাগরি রেট')}
            </Button>
          )
        }
        cards={cards}
        aside={aside}
        filterClass="ll-filters rt-filters"
        filters={
          <>
            <Field label={tx('মৌসুম')}>
              <Select value={draft.season_id ?? ''} options={[{ value: '', label: tx('সব মৌসুম') }, ...(meta?.seasons ?? []).map((x) => ({ value: x.id, label: x.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, season_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('জমির ধরন')}>
              <Select value={draft.land_type_id ?? ''} options={[{ value: '', label: tx('সব ধরনের জমি') }, ...(landMeta?.land_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, land_type_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('সেচের ধরন')}>
              <Select value={draft.irrigation_type_id ?? ''} options={[{ value: '', label: tx('সব উৎস') }, ...(meta?.irrigation_types ?? []).map((t) => ({ value: t.id, label: t.name_bn }))]} onChange={(v) => setDraft((d) => ({ ...d, irrigation_type_id: v === '' ? undefined : Number(v) }))} />
            </Field>
            <Field label={tx('অবস্থা')}>
              <Select value={draft.state ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(data?.states ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, state: v || undefined }))} />
            </Field>
            <span className="ll-break" />
            <Field grow={600}>
              <Input prefix={<SearchOutlined />} allowClear placeholder={tx('ক্যাটাগরির নাম বা বিবরণ দিয়ে খুঁজুন...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={() => show(draft)} />
            </Field>
          </>
        }
        onSearch={() => show(draft)}
        onReset={() => show({})}
        tableTitle={tx('ক্যাটাগরি রেটের তালিকা ({{p0}})', { p0: n0(total) })}
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
        <Table<RateRow>
          className="fl-table ml-table pl-table rt-table"
          rowKey="id"
          loading={isFetching}
          dataSource={data?.data ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={columns}
          rowClassName={(r) => (editing?.id === r.id ? 'lt-current' : '')}
        />
        <div className="rt-note">
          <InfoCircleFilled />
          <div>
            <strong>{tx('নোট')}</strong>
            <ul>
              <li>{tx('ইনভয়েসের সেচ চার্জ এই রেট থেকে হিসাব হয়।')}</li>
              <li>{tx('রেট মৌসুম, জমির ধরন ও সেচের ধরন অনুযায়ী আলাদা হতে পারে।')}</li>
              <li>{tx('নতুন বা পরিবর্তিত রেট অনুমোদনের পরেই ইনভয়েসে ব্যবহার হয়।')}</li>
            </ul>
          </div>
        </div>
      </ListFrame>
    </>
  )
}
