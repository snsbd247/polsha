import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, CloseOutlined, DeleteFilled, EditFilled, InfoCircleFilled, PlusOutlined, SettingFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { acres, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './rates.css'

type LiftRow = {
  id: number
  code: string
  name_bn: string
  name_en: string | null
  description: string | null
  is_active: boolean
  sort_order: number
  lands_count: number
  rates_count: number
  area_decimal: number
  in_use: boolean
}

/** The lifts (1st, 2nd, 3rd …) plots sit on; one in use is made inactive rather than removed. */
export default function LiftsPage({ tabs }: { tabs?: ReactNode } = {}) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LiftRow | 'new' | null>(null)
  const [form] = Form.useForm()
  const canEdit = can('settings.admin')
  const activeNow: boolean | undefined = Form.useWatch('is_active', form)
  // turning off a lift that still has plots: they must go to another lift first
  const closing = editing && editing !== 'new' && editing.is_active && activeNow === false && editing.lands_count > 0 ? editing : null

  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-lifts'],
    queryFn: async () => (await api.get<{ data: LiftRow[]; without_lift: number }>('/irrigation-lifts')).data,
  })
  const rows = data?.data ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['irrigation-lifts'] })
    queryClient.invalidateQueries({ queryKey: ['land-meta'] })
    queryClient.invalidateQueries({ queryKey: ['invoice-meta'] })
  }
  const open = (l: LiftRow | 'new') => {
    setEditing(l)
    form.resetFields()
    form.setFieldsValue(l === 'new' ? { is_active: true, sort_order: rows.length + 1, code: `L${rows.length + 1}` } : l)
  }
  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') {
        await api.post('/irrigation-lifts', v)
        message.success(tx('সংরক্ষণ হয়েছে।'))
      } else {
        const r = await api.put<{ message: string }>(`/irrigation-lifts/${(editing as LiftRow).id}`, v)
        message.success(r.data.message)
      }
      setEditing(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  const remove = (l: LiftRow) =>
    Modal.confirm({
      title: tx('"{{p0}}" মুছে ফেলবেন?', { p0: nameOf(l) }),
      content: tx('এই লিফট কোথাও ব্যবহৃত হয়নি।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const r = await api.delete(`/irrigation-lifts/${l.id}`)
          message.success(r.data.message)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const cards = [
    { key: 'total', label: tx('মোট লিফট'), value: data ? rows.length : undefined, icon: '', glyph: <SettingFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'active', label: tx('সক্রিয় লিফট'), value: data ? rows.filter((l) => l.is_active).length : undefined, icon: '', glyph: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'nolift', label: tx('লিফট বসানো নেই এমন জমি'), value: data?.without_lift, icon: '', glyph: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => navigate('/lands?lift_id=none') },
  ]

  const columns: ColumnsType<LiftRow> = [
    { title: tx('ক্রম'), dataIndex: 'sort_order', width: 60, align: 'center', render: (v) => digits(v) },
    { title: tx('লিফটের নাম'), render: (_, l) => <span className="fl-name">{nameOf(l)}</span> },
    { title: tx('কোড'), dataIndex: 'code' },
    { title: tx('বিবরণ'), dataIndex: 'description', className: 'lt-desc', render: (v) => v || '—' },
    {
      title: tx('জমির সংখ্যা'),
      dataIndex: 'lands_count',
      align: 'right',
      render: (v: number, l) => (
        <button type="button" className="lt-name" onClick={() => navigate(`/lands?lift_id=${l.id}`)}>
          {n0(v)}
        </button>
      ),
    },
    { title: tx('জমি (একর)'), dataIndex: 'area_decimal', align: 'right', render: (v: number) => acres(v) },
    { title: tx('রেটে ব্যবহৃত'), dataIndex: 'rates_count', render: (v: number) => (v > 0 ? tx('হ্যাঁ') : tx('না')) },
    { title: tx('অবস্থা'), dataIndex: 'is_active', align: 'center', render: (v) => (v ? <Tag className="fl-tag fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 110,
      align: 'center',
      render: (_, l) =>
        canEdit && (
          <div className="mg-actions lt-actions">
            <Button type="text" className="mg-view" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => open(l)} />
            <Button type="text" className="mg-view lt-del" icon={<DeleteFilled />} aria-label={tx('মুছুন')} disabled={l.in_use} onClick={() => remove(l)} />
          </div>
        ),
    },
  ]

  return (
    <ListFrame
      above={tabs}
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('লিফট')}
      subtitle={tx('পানি কয় ধাপে তুলে জমিতে পৌঁছায় — জমির লিফট অনুযায়ী সেচের রেট হয়।')}
      actions={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন লিফট')}
          </Button>
        )
      }
      cards={cards}
      statsClass="lt-three"
      tableTitle={tx('লিফটের তালিকা ({{p0}})', { p0: n0(rows.length) })}
    >
      <Table<LiftRow> className="fl-table ml-table pl-table lt-table" rowKey="id" loading={isFetching} dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} columns={columns} />
      <div className="rt-note">
        <InfoCircleFilled />
        <div>
          <strong>{tx('নোট')}</strong>
          <ul>
            <li>{tx('জমির ফর্মে বা জমির তালিকা থেকে একসাথে অনেক জমিতে লিফট বসানো যায়।')}</li>
            <li>{tx('জমি, রেট বা ইনভয়েসে ব্যবহৃত লিফট মোছা যায় না — নিষ্ক্রিয় করুন।')}</li>
            <li>{tx('শুধু সক্রিয় লিফট নতুন রেট ও জমিতে বাছাই করা যায়।')}</li>
          </ul>
        </div>
      </div>
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন লিফট') : tx('লিফট সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('লিফটের নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]} extra={tx('যেমন: ৪র্থ লিফট')}>
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={tx('লিফটের নাম (English)')}>
            <Input placeholder="4th Lift" />
          </Form.Item>
          <Form.Item name="code" label={tx('কোড')} rules={[required(tx('কোড দিন'))]} normalize={(v?: string) => v?.toUpperCase()} extra={tx('যেমন: L4')}>
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
          {closing && (
            <Form.Item
              name="move_to_lift_id"
              label={tx('এই লিফটের {{p0}}টি জমি কোন লিফটে যাবে?', { p0: n0(closing.lands_count) })}
              rules={[required(tx('লিফট বাছাই করুন'))]}
              extra={tx('সংরক্ষণ করলে জমিগুলো সাথে সাথে সরে যাবে; নতুন বিল সেই লিফটের রেটে হবে। পুরোনো বিল বদলাবে না।')}
            >
              <Select placeholder={tx('লিফট বাছাই করুন')} options={rows.filter((l) => l.is_active && l.id !== closing.id).map((l) => ({ value: l.id, label: nameOf(l) }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </ListFrame>
  )
}
