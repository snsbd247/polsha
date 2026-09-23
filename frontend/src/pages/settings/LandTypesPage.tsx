import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'

type LandType = { id: number; name_bn: string; category: string | null; description: string | null; is_active: boolean; sort_order: number; lands_count: number }

export default function LandTypesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LandType | 'new' | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({ queryKey: ['land-types'], queryFn: async () => (await api.get<LandType[]>('/land-types')).data })

  const open = (t: LandType | 'new') => {
    setEditing(t)
    form.resetFields()
    form.setFieldsValue(t === 'new' ? { is_active: true, sort_order: (data?.length ?? 0) + 1 } : t)
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/land-types', v)
      else await api.put(`/land-types/${(editing as LandType).id}`, v)
      message.success('সংরক্ষণ হয়েছে।')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['land-types'] })
      queryClient.invalidateQueries({ queryKey: ['land-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>জমির ধরন</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
          নতুন ধরন
        </Button>
      </div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="ফেজ ৫-এ সেচের রেট জমির ধরন অনুযায়ী ঠিক হবে। ব্যবহৃত ধরন মুছে না ফেলে নিষ্ক্রিয় করুন।" />
      <Table<LandType>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'ক্রম', dataIndex: 'sort_order', width: 70, render: digits },
          { title: 'নাম', dataIndex: 'name_bn' },
          { title: 'শ্রেণি', dataIndex: 'category' },
          { title: 'বিবরণ', dataIndex: 'description' },
          { title: 'জমির সংখ্যা', dataIndex: 'lands_count', render: digits },
          { title: 'অবস্থা', dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">সক্রিয়</Tag> : <Tag>নিষ্ক্রিয়</Tag>) },
          { title: '', width: 100, render: (_, t) => <Button onClick={() => open(t)}>সম্পাদনা</Button> },
        ]}
      />
      <Modal open={!!editing} forceRender title={editing === 'new' ? 'নতুন জমির ধরন' : 'জমির ধরন সম্পাদনা'} onCancel={() => setEditing(null)} onOk={save} okText="সংরক্ষণ" cancelText="বাতিল">
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label="নাম" rules={[required('নাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label="শ্রেণি" extra="যেমন: উঁচু, মাঝারি, নিচু, অকৃষি">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="বিবরণ">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="sort_order" label="ক্রম">
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="is_active" label="অবস্থা" valuePropName="checked">
            <Switch checkedChildren="সক্রিয়" unCheckedChildren="নিষ্ক্রিয়" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
