import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Drawer, Form, Input, InputNumber, Switch, Table, Tag } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import type { WaterType } from '../../lib/water'
import PageFrame from '../../components/PageFrame'

/** The tariff: each connection type's fixed monthly fee and its connection fee. */
export default function TypesPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [editing, setEditing] = useState<WaterType | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['water', 'types'], queryFn: async () => (await api.get<WaterType[]>('/water/types')).data })
  const admin = can('water.admin')

  const open = (t: WaterType | 'new') => {
    form.resetFields()
    form.setFieldsValue(t === 'new' ? { is_active: true, monthly_fee: 0, connection_fee: 0 } : { ...t, monthly_fee: Number(t.monthly_fee), connection_fee: Number(t.connection_fee) })
    setEditing(t)
  }
  const save = async (v: Partial<WaterType>) => {
    setSaving(true)
    try {
      if (editing === 'new') await api.post('/water/types', v)
      else if (editing) await api.put(`/water/types/${editing.id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['water'] })
      queryClient.invalidateQueries({ queryKey: ['water-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('সংযোগের ধরন ও মাসিক ফি') }]}
      title={tx('সংযোগের ধরন ও মাসিক ফি')}
      subtitle={tx('প্রতিটি ধরনের নির্দিষ্ট মাসিক বিল। ফি বদলালে পরের মাসের বিল থেকে নতুন ফি লাগে; আগের বিল বদলায় না।')}
      actions={
        admin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন ধরন')}
          </Button>
        )
      }
    >
      <Table<WaterType>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: tx('কোড'), dataIndex: 'code', width: 90 },
          { title: tx('ধরন'), render: (_, t) => nameOf(t) },
          { title: tx('মাসিক ফি'), dataIndex: 'monthly_fee', width: 120, align: 'right', render: (v) => (Number(v) > 0 ? `৳ ${money(v)}` : <Tag color="gold">{tx('ঠিক করা নেই')}</Tag>) },
          { title: tx('সংযোগ ফি'), dataIndex: 'connection_fee', width: 120, align: 'right', render: (v) => `৳ ${money(v)}` },
          { title: tx('চালু সংযোগ'), dataIndex: 'active_count', width: 110, align: 'right', render: (v: number) => digits(v ?? 0) },
          { title: tx('অবস্থা'), dataIndex: 'is_active', width: 100, render: (v: boolean) => (v ? <Tag color="green">{tx('সক্রিয়')}</Tag> : <Tag>{tx('নিষ্ক্রিয়')}</Tag>) },
          { title: '', width: 60, render: (_, t) => (admin ? <Button size="small" icon={<EditOutlined />} onClick={() => open(t)} aria-label={tx('সম্পাদনা')} /> : null) },
        ]}
      />
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        size={420}
        title={editing === 'new' ? tx('নতুন সংযোগের ধরন') : tx('ধরন সম্পাদনা')}
        extra={
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {tx('সংরক্ষণ')}
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="code" label={tx('কোড')} rules={[{ required: true, message: tx('কোড দিন') }]}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[{ required: true, message: tx('নাম দিন') }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="monthly_fee" label={tx('মাসিক ফি')} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
          <Form.Item name="connection_fee" label={tx('সংযোগ ফি')} rules={[{ required: true }]} extra={tx('নতুন সংযোগের ফর্মে আগে থেকে বসে; সেখানে বদলানো যায়।')}>
            <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
          <Form.Item name="sort_order" label={tx('ক্রম')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={tx('সক্রিয়')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </PageFrame>
  )
}
