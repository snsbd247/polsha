import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, MoreOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import ListFrame, { acres, ExportMenu, Field, n0 } from '../lands/ListFrame'

type LandType = {
  id: number
  name_bn: string
  display_name: string
  category: string | null
  display_category: string | null
  description: string | null
  is_active: boolean
  sort_order: number
  lands_count: number
  land_decimal: number
}
type Filters = { search?: string; category?: string; status?: string }

/** Land types (used by irrigation rates); a type in use is deactivated rather than removed. */
export default function LandTypesPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LandType | 'new' | null>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({ queryKey: ['land-types'], queryFn: async () => (await api.get<LandType[]>('/land-types')).data })
  const totals = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ lands: number; land_acre: number }>('/mouzas-summary')).data })
  const canEdit = can('settings.admin')

  const all = useMemo(() => data ?? [], [data])
  const rows = all.filter(
    (t) =>
      (!filters.search || `${t.display_name} ${t.name_bn} ${t.description ?? ''}`.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.category || t.category === filters.category) &&
      (!filters.status || (filters.status === 'active') === t.is_active),
  )
  const categories = [...new Map(all.filter((t) => t.category).map((t) => [t.category!, t.display_category ?? t.category!])).entries()]
  const typed = all.reduce((s, t) => s + t.lands_count, 0)

  const open = (t: LandType | 'new') => {
    setEditing(t)
    form.resetFields()
    form.setFieldsValue(t === 'new' ? { is_active: true, sort_order: all.length + 1 } : t)
  }
  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/land-types', v)
      else await api.put(`/land-types/${(editing as LandType).id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['land-types'] })
      queryClient.invalidateQueries({ queryKey: ['land-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  const toggle = async (t: LandType) => {
    try {
      await api.put(`/land-types/${t.id}`, { name_bn: t.name_bn, category: t.category, description: t.description, sort_order: t.sort_order, is_active: !t.is_active })
      queryClient.invalidateQueries({ queryKey: ['land-types'] })
      queryClient.invalidateQueries({ queryKey: ['land-meta'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'total', label: tx('মোট জমির ধরন'), value: data ? all.length : undefined, icon: 'layers', color: '#2563eb', tint: '#e4edfd', onClick: () => { setDraft({}); setFilters({}) } },
    { key: 'active', label: tx('সক্রিয় ধরন'), value: data ? all.filter((t) => t.is_active).length : undefined, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', onClick: () => setFilters({ status: 'active' }) },
    { key: 'typed', label: tx('ধরন দেওয়া জমি'), value: data ? typed : undefined, icon: 'sprout', color: '#f08c00', tint: '#fdf0dc' },
    { key: 'untyped', label: tx('ধরন ছাড়া জমি'), value: data && totals.data ? Math.max(0, totals.data.lands - typed) : undefined, icon: 'file', color: '#e0383e', tint: '#fde6e7' },
  ]

  const columns: ColumnsType<LandType> = [
    { title: tx('ক্রম'), dataIndex: 'sort_order', width: 64, align: 'center', render: (v) => digits(v) },
    { title: tx('জমির ধরন'), dataIndex: 'display_name', render: (v) => <span className="fl-name">{v}</span> },
    { title: tx('শ্রেণি'), dataIndex: 'display_category', render: (v) => v || '—' },
    { title: tx('বিবরণ'), dataIndex: 'description', render: (v) => v || '—' },
    { title: tx('জমির সংখ্যা'), dataIndex: 'lands_count', render: (v) => n0(v) },
    { title: tx('মোট পরিমাণ (একর)'), dataIndex: 'land_decimal', render: (v) => acres(v) },
    { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      render: (_, t) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!canEdit} onClick={() => open(t)} />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'lands', label: tx('এই ধরনের জমি দেখুন'), onClick: () => navigate(`/lands?land_type_id=${t.id}`) },
                ...(canEdit ? [{ key: 'toggle', label: t.is_active ? tx('নিষ্ক্রিয় করুন') : tx('সক্রিয় করুন'), onClick: () => toggle(t) }] : []),
              ],
            }}
          >
            <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
          </Dropdown>
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('জমি ব্যবস্থাপনা'), to: '/lands' }}
      title={tx('জমির ধরন')}
      subtitle={tx('জমির ধরন ও শ্রেণি পরিচালনা করুন। সেচের রেট জমির ধরন অনুযায়ী ঠিক হয়; ব্যবহৃত ধরন মুছে না ফেলে নিষ্ক্রিয় করুন।')}
      actions={
        <>
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              {tx('নতুন ধরন')}
            </Button>
          )}
          <ExportMenu reports={[{ key: 'land_by_type', label: tx('ধরনভিত্তিক জমি') }]} filters={{}} />
        </>
      }
      cards={cards}
      filters={
        <>
          <Field grow={320}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('ধরনের নাম বা বিবরণ দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => setFilters(draft)}
            />
          </Field>
          <Field label={tx('শ্রেণি')}>
            <Select value={draft.category ?? ''} options={[{ value: '', label: tx('সকল') }, ...categories.map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, category: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
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
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => {
        setDraft({})
        setFilters({})
      }}
      tableTitle={tx('জমির ধরনের তালিকা ({{p0}})', { p0: n0(rows.length) })}
    >
      <Table<LandType> className="fl-table ml-table pl-table" rowKey="id" loading={isFetching} dataSource={rows} pagination={false} scroll={{ x: 900 }} columns={columns} />
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন জমির ধরন') : tx('জমির ধরন সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('নাম')} rules={[required(tx('নাম দিন'))]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label={tx('শ্রেণি')} extra={tx('যেমন: উঁচু, মাঝারি, নিচু, অকৃষি')}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={tx('বিবরণ')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="sort_order" label={tx('ক্রম')}>
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
          </Form.Item>
        </Form>
      </Modal>
    </ListFrame>
  )
}
