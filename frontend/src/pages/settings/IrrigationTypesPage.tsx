import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, CloseOutlined, DeleteFilled, EditFilled, InfoCircleFilled, PlusOutlined, SettingFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import './land-types.css'
import '../irrigation/rates.css'

type IrrigationType = {
  id: number
  name_bn: string
  display_name: string
  code: string | null
  description: string | null
  is_active: boolean
  sort_order: number
  lands_count: number
  rates_count: number
  in_use: boolean
}
type Filters = { search?: string; status?: string; used?: string }

/** Irrigation types (sources) used by rates and invoices; one in use is made inactive rather than removed. */
export default function IrrigationTypesPage({ tabs }: { tabs?: ReactNode } = {}) {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<IrrigationType | 'new' | null>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [form] = Form.useForm()
  const canEdit = can('settings.admin')

  const { data, isFetching } = useQuery({ queryKey: ['irrigation-types'], queryFn: async () => (await api.get<IrrigationType[]>('/irrigation-types')).data })
  const all = useMemo(() => data ?? [], [data])
  const rows = all.filter(
    (t) =>
      (!filters.search || `${t.display_name} ${t.name_bn} ${t.code ?? ''} ${t.description ?? ''}`.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.status || (filters.status === 'active') === t.is_active) &&
      (!filters.used || (filters.used === 'yes') === t.rates_count > 0),
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['irrigation-types'] })
    queryClient.invalidateQueries({ queryKey: ['land-meta'] })
    queryClient.invalidateQueries({ queryKey: ['invoice-meta'] })
  }
  const open = (t: IrrigationType | 'new') => {
    setEditing(t)
    form.resetFields()
    form.setFieldsValue(t === 'new' ? { is_active: true, sort_order: all.length + 1 } : t)
  }
  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/irrigation-types', v)
      else await api.put(`/irrigation-types/${(editing as IrrigationType).id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  const remove = (t: IrrigationType) =>
    Modal.confirm({
      title: tx('"{{p0}}" মুছে ফেলবেন?', { p0: t.display_name }),
      content: t.in_use ? tx('এই সেচের ধরন জমি, রেট বা ইনভয়েসে ব্যবহৃত হয়েছে; মুছে না ফেলে নিষ্ক্রিয় করুন।') : tx('এই ধরন কোথাও ব্যবহৃত হয়নি।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true, disabled: t.in_use },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/irrigation-types/${t.id}`)
          message.success(r.data.message)
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
    { key: 'total', label: tx('মোট ধরন'), value: data ? all.length : undefined, icon: '', glyph: <SettingFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'active', label: tx('সক্রিয় ধরন'), value: data ? all.filter((t) => t.is_active).length : undefined, icon: '', glyph: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'active' }) },
    { key: 'inactive', label: tx('নিষ্ক্রিয় ধরন'), value: data ? all.filter((t) => !t.is_active).length : undefined, icon: '', glyph: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'inactive' }) },
  ]

  const columns: ColumnsType<IrrigationType> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
    { title: tx('ধরনের নাম'), dataIndex: 'display_name', render: (v) => <span className="fl-name">{v}</span> },
    { title: tx('কোড'), dataIndex: 'code', render: (v) => v ?? '—' },
    { title: tx('বিবরণ'), dataIndex: 'description', className: 'lt-desc', render: (v) => v || '—' },
    { title: tx('মাপের একক'), render: () => tx('শতক') },
    { title: tx('রেটে ব্যবহৃত'), dataIndex: 'rates_count', render: (v: number) => (v > 0 ? tx('হ্যাঁ') : tx('না')) },
    { title: tx('জমি'), dataIndex: 'lands_count', align: 'right', render: (v: number) => n0(v) },
    { title: tx('অবস্থা'), dataIndex: 'is_active', align: 'center', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      render: (_, t) =>
        canEdit && (
          <div className="mg-actions lt-actions">
            <Button type="text" className="mg-view" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => open(t)} />
            <Button type="text" className="mg-view lt-del" icon={<DeleteFilled />} aria-label={tx('মুছুন')} disabled={t.in_use} onClick={() => remove(t)} />
          </div>
        ),
    },
  ]

  return (
    <ListFrame
      above={tabs}
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tabs ? tx('সেচের রেট') : tx('সেচের ধরন')}
      subtitle={tx('রেট নির্ধারণ ও ইনভয়েস তৈরিতে ব্যবহৃত সেচের ধরন পরিচালনা করুন।')}
      actions={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন সেচের ধরন')}
          </Button>
        )
      }
      cards={cards}
      statsClass="lt-three"
      filterClass="rt-filters"
      filters={
        <>
          <Field grow={520}>
            <Input
              allowClear
              placeholder={tx('সেচের ধরনের নাম, কোড বা বিবরণ দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => setFilters(draft)}
            />
          </Field>
          <Field label={tx('অবস্থা')} grow={240}>
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
          <Field label={tx('রেটে ব্যবহৃত')} grow={240}>
            <Select
              value={draft.used ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'yes', label: tx('হ্যাঁ') },
                { value: 'no', label: tx('না') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, used: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => show({})}
      tableTitle={tx('সেচের ধরনের তালিকা ({{p0}})', { p0: n0(rows.length) })}
    >
      <Table<IrrigationType> className="fl-table ml-table pl-table lt-table" rowKey="id" loading={isFetching} dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} columns={columns} />
      <div className="rt-note">
        <InfoCircleFilled />
        <div>
          <strong>{tx('নোট')}</strong>
          <ul>
            <li>{tx('সেচের ধরন রেট নির্ধারণ ও ইনভয়েস তৈরিতে ব্যবহার হয়।')}</li>
            <li>{tx('এই সমিতিতে রেট হিসাব হয় প্রতি শতক জমির জন্য।')}</li>
            <li>{tx('শুধু সক্রিয় ধরন নতুন রেট ও জমিতে বাছাই করা যায়।')}</li>
          </ul>
        </div>
      </div>
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন সেচের ধরন') : tx('সেচের ধরন সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('ধরনের নাম')} rules={[required(tx('নাম দিন'))]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label={tx('কোড')} rules={[required(tx('কোড দিন'))]} normalize={(v?: string) => v?.toUpperCase()} extra={tx('যেমন: DTW, STW')}>
            <Input maxLength={12} />
          </Form.Item>
          <Form.Item name="description" label={tx('বিবরণ')}>
            <Input.TextArea rows={2} maxLength={500} />
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
