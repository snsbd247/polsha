import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'

type IrrigationType = { id: number; name_bn: string; display_name: string; description: string | null; is_active: boolean; sort_order: number; lands_count: number }

export default function IrrigationTypesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<IrrigationType | 'new' | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({ queryKey: ['irrigation-types'], queryFn: async () => (await api.get<IrrigationType[]>('/irrigation-types')).data })

  const open = (t: IrrigationType | 'new') => {
    setEditing(t)
    form.resetFields()
    form.setFieldsValue(t === 'new' ? { is_active: true, sort_order: (data?.length ?? 0) + 1 } : t)
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/irrigation-types', v)
      else await api.put(`/irrigation-types/${(editing as IrrigationType).id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['irrigation-types'] })
      queryClient.invalidateQueries({ queryKey: ['land-meta'] })
      queryClient.invalidateQueries({ queryKey: ['invoice-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('সেচের ধরন')}</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
          {tx('নতুন ধরন')}
        </Button>
      </div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('সেচের রেট সেচের ধরন (ও প্রয়োজনে জমির ধরন) অনুযায়ী ঠিক হয়। ব্যবহৃত ধরন মুছে না ফেলে নিষ্ক্রিয় করুন।')} />
      <Table<IrrigationType>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: tx('ক্রম'), dataIndex: 'sort_order', width: 70, render: digits },
          { title: tx('নাম'), dataIndex: 'display_name' },
          { title: tx('বিবরণ'), dataIndex: 'description' },
          { title: tx('জমির সংখ্যা'), dataIndex: 'lands_count', render: digits },
          { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">{tx('সক্রিয়')}</Tag> : <Tag>{tx('নিষ্ক্রিয়')}</Tag>) },
          { title: '', width: 100, render: (_, t) => <Button onClick={() => open(t)}>{tx('সম্পাদনা')}</Button> },
        ]}
      />
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন সেচের ধরন') : tx('সেচের ধরন সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('নাম')} rules={[required(tx('নাম দিন'))]}>
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
    </>
  )
}
