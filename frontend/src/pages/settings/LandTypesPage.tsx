import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteFilled, EditFilled, EyeFilled, FileAddFilled, HomeFilled, PlusOutlined, PrinterOutlined, SaveFilled, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import ListFrame, { acres, ExportMenu, Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import './land-types.css'

type LandType = {
  id: number
  name_bn: string
  display_name: string
  code: string | null
  category: string | null
  display_category: string | null
  description: string | null
  default_rate: number
  is_active: boolean
  sort_order: number
  lands_count: number
  land_decimal: number
  in_use: boolean
}
type Filters = { search?: string; category?: string; status?: string }
type Panel = { mode: 'new' | 'edit' | 'view'; type?: LandType } | null

// tag colour per category, as in the approved design
const TONE: Record<string, string> = { agricultural: 'll-green', residential: 'll-blue', waterbody: 'lt-water', non_agricultural: 'll-purple', other: 'll-gray' }

/** Land types — used by lands and irrigation rates; a type in use is made inactive rather than removed. */
export default function LandTypesPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<Panel>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({ queryKey: ['land-types'], queryFn: async () => (await api.get<LandType[]>('/land-types')).data })
  const meta = useQuery({ queryKey: ['land-types', 'meta'], queryFn: async () => (await api.get<{ categories: Record<string, string> }>('/land-types/meta')).data })
  const canEdit = can('settings.admin')
  const categories = meta.data?.categories ?? {}

  const all = useMemo(() => data ?? [], [data])
  const rows = all.filter(
    (t) =>
      (!filters.search || `${t.display_name} ${t.name_bn} ${t.code ?? ''} ${t.description ?? ''}`.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.category || t.category === filters.category) &&
      (!filters.status || (filters.status === 'active') === t.is_active),
  )
  const count = (...cats: string[]) => (data ? all.filter((t) => cats.includes(t.category ?? '')).length : undefined)

  useEffect(() => {
    if (!panel) return
    form.resetFields()
    form.setFieldsValue(panel.type ? { ...panel.type, is_active: panel.type.is_active ? 1 : 0 } : { is_active: 1, default_rate: 0, sort_order: all.length + 1 })
  }, [panel, form, all.length])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['land-types'] })
    queryClient.invalidateQueries({ queryKey: ['land-meta'] })
  }
  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const body = { ...v, is_active: v.is_active === 1 }
      if (panel?.mode === 'edit' && panel.type) await api.put(`/land-types/${panel.type.id}`, body)
      else await api.post('/land-types', body)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setPanel(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const remove = (t: LandType) =>
    Modal.confirm({
      title: tx('"{{p0}}" মুছে ফেলবেন?', { p0: t.display_name }),
      content: t.in_use ? tx('এই ধরন জমি, সেচ বিল বা রেটে ব্যবহৃত হয়েছে; মুছে না ফেলে নিষ্ক্রিয় করুন।') : tx('এই ধরন কোথাও ব্যবহৃত হয়নি।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true, disabled: t.in_use },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/land-types/${t.id}`)
          message.success(r.data.message)
          if (panel?.type?.id === t.id) setPanel(null)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
  }
  const cards = [
    { key: 'total', label: tx('মোট জমির ধরন'), value: data ? all.length : undefined, icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({}) },
    { key: 'agri', label: tx('কৃষি ধরন'), value: count('agricultural'), icon: 'sprout', color: '#f08c00', tint: '#fdefd6', onClick: () => show({ category: 'agricultural' }) },
    { key: 'non', label: tx('অকৃষি ধরন'), value: count('residential', 'non_agricultural'), icon: '', glyph: <HomeFilled />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ category: 'non_agricultural' }) },
    // the design drops the fourth card while the form panel is open
    ...(panel ? [] : [{ key: 'water', label: tx('জলাশয় ধরন'), value: count('waterbody'), icon: 'drop', color: '#1769e0', tint: '#e4edfd', onClick: () => show({ category: 'waterbody' }) }]),
  ]

  const columns: ColumnsType<LandType> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
    {
      title: tx('ধরনের নাম'),
      dataIndex: 'display_name',
      render: (v, t) => (
        <button type="button" className="lt-name" onClick={() => setPanel({ mode: 'view', type: t })}>
          {v}
        </button>
      ),
    },
    { title: tx('ধরনের কোড'), dataIndex: 'code', render: (v) => v ?? '—' },
    { title: tx('শ্রেণি'), dataIndex: 'category', render: (c, t) => (c ? <Tag className={`fl-tag ${TONE[c] ?? 'll-gray'}`}>{t.display_category}</Tag> : '—') },
    { title: tx('বিবরণ'), dataIndex: 'description', className: 'lt-desc', render: (v) => v || '—' },
    { title: <span className="lt-rate-head">{tx('ডিফল্ট রেট (৳/একর)')}</span>, dataIndex: 'default_rate', align: 'center', render: (v: number) => n0(Number(v ?? 0)) },
    { title: tx('অবস্থা'), dataIndex: 'is_active', align: 'center', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      render: (_, t) => (
        <div className="mg-actions lt-actions">
          <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setPanel({ mode: 'view', type: t })} />
          {canEdit && (
            <>
              <Button type="text" className="mg-view" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => setPanel({ mode: 'edit', type: t })} />
              <Button type="text" className="mg-view lt-del" icon={<DeleteFilled />} aria-label={tx('মুছুন')} onClick={() => remove(t)} />
            </>
          )}
        </div>
      ),
    },
  ]

  const view = panel?.mode === 'view'
  const aside = panel && (
    <aside className="lt-panel">
      <header>
        <FileAddFilled />
        <h3>{panel.mode === 'new' ? tx('নতুন জমির ধরন') : panel.mode === 'edit' ? tx('জমির ধরন সম্পাদনা') : tx('জমির ধরনের বিবরণ')}</h3>
      </header>
      <Form form={form} layout="vertical" disabled={view} requiredMark className="lt-form">
        <Form.Item name="name_bn" label={tx('ধরনের নাম')} rules={[required(tx('নাম দিন'))]}>
          <Input placeholder={tx('যেমন: কৃষি জমি')} />
        </Form.Item>
        <Form.Item name="code" label={tx('ধরনের কোড')} rules={[required(tx('কোড দিন'))]} extra={tx('ছোট কোড (২–৫ অক্ষর)')} normalize={(v?: string) => v?.toUpperCase()}>
          <Input placeholder="e.g. AGR" maxLength={5} />
        </Form.Item>
        <Form.Item name="category" label={tx('শ্রেণি')} rules={[required(tx('শ্রেণি বাছাই করুন'))]}>
          <Select placeholder={tx('শ্রেণি বাছাই করুন')} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="description" label={tx('বিবরণ')}>
          <Input.TextArea rows={4} placeholder={tx('বিবরণ লিখুন...')} maxLength={500} />
        </Form.Item>
        <Form.Item name="default_rate" label={tx('ডিফল্ট রেট (৳/একর)')} extra={tx('সেচ/মূল্যায়নের ডিফল্ট রেট (ঐচ্ছিক)')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="is_active" label={tx('অবস্থা')} rules={[required(tx('অবস্থা বাছাই করুন'))]}>
          <Select
            options={[
              { value: 1, label: tx('সক্রিয়') },
              { value: 0, label: tx('নিষ্ক্রিয়') },
            ]}
          />
        </Form.Item>
        <Form.Item name="sort_order" hidden>
          <InputNumber />
        </Form.Item>
      </Form>
      {view && panel.type && (
        <dl className="lt-usage">
          <dt>{tx('এই ধরনের জমি')}</dt>
          <dd>
            <button type="button" className="lt-name" onClick={() => navigate(`/lands?land_type_id=${panel.type!.id}`)}>
              {tx('{{p0}}টি জমি · {{p1}} একর', { p0: n0(panel.type.lands_count), p1: acres(panel.type.land_decimal) })}
            </button>
          </dd>
        </dl>
      )}
      <footer>
        <Button onClick={() => setPanel(null)}>{view ? tx('বন্ধ করুন') : tx('বাতিল')}</Button>
        {view ? (
          canEdit && (
            <Button type="primary" icon={<EditFilled />} onClick={() => setPanel({ mode: 'edit', type: panel.type })}>
              {tx('সম্পাদনা')}
            </Button>
          )
        ) : (
          <Button type="primary" icon={<SaveFilled />} loading={saving} onClick={save}>
            {tx('জমির ধরন সংরক্ষণ')}
          </Button>
        )}
      </footer>
    </aside>
  )

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={panel ? tx('জমির ধরনসমূহ') : tx('জমির ধরনের তালিকা')}
      subtitle={tx('বিভিন্ন ধরনের জমি পরিচালনা করুন। জমির রেকর্ড যোগ বা সম্পাদনার সময় এই ধরনগুলো ব্যবহার হয়।')}
      actions={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setPanel({ mode: 'new' })}>
            {tx('নতুন জমির ধরন')}
          </Button>
        )
      }
      cards={cards}
      statsClass={panel ? 'lt-three' : undefined}
      aside={aside}
      filterClass="lt-filters"
      filters={
        <>
          <Field grow={420}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('ধরনের নাম, কোড বা বিবরণ দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => setFilters(draft)}
            />
          </Field>
          <Field label={tx('শ্রেণি')} grow={panel ? 170 : 240}>
            <Select value={draft.category ?? ''} options={[{ value: '', label: tx('সকল') }, ...Object.entries(categories).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, category: v || undefined }))} />
          </Field>
          {!panel && (
            <Field label={tx('অবস্থা')} grow={300}>
              <Select
                value={draft.status ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: 'active', label: tx('সক্রিয়') },
                  { value: 'inactive', label: tx('নিষ্ক্রিয়') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
              />
            </Field>
          )}
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => show({})}
      tableTitle={tx('জমির ধরনের তালিকা ({{p0}})', { p0: n0(rows.length) })}
      tableTools={
        !panel && (
          <>
            <ExportMenu reports={[{ key: 'land_by_type', label: tx('ধরনভিত্তিক জমি') }]} filters={{}} />
            <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
              {tx('প্রিন্ট')}
            </Button>
          </>
        )
      }
      paging={{ page: 1, perPage: Math.max(10, rows.length), total: rows.length, showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(rows.length ? 1 : 0), p1: n0(rows.length), p2: n0(rows.length) }), onPage: () => {}, onPerPage: () => {} }}
    >
      <Table<LandType>
        className="fl-table ml-table pl-table lt-table"
        rowKey="id"
        loading={isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        rowClassName={(t) => (panel?.type?.id === t.id ? 'lt-current' : '')}
      />
    </ListFrame>
  )
}
