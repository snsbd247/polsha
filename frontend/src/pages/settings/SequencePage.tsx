import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import type { Sequence } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

export default function SequencePage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Sequence | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['sequences'],
    queryFn: async () => (await api.get<Sequence[]>('/sequences')).data,
  })

  const open = (s: Sequence) => {
    setEditing(s)
    form.setFieldsValue(s)
  }

  const save = async () => {
    const values = await form.validateFields()
    try {
      await api.put(`/sequences/${editing!.id}`, values)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['sequences'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('সিরিয়াল নম্বর')}</h2>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={tx('পুরোনো সদস্য নম্বর (যেমন ১০০০১) Import-এর পর Member Number-এর \'পরবর্তী নম্বর\' সর্বোচ্চ পুরোনো নম্বর + ১ করে দিন। পরবর্তী নম্বর কমানো যায় না।')}
      />
      <Table<Sequence>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: tx('ধরন'), dataIndex: 'label' },
          { title: 'Prefix', dataIndex: 'prefix', render: (v) => <code>{v || '—'}</code> },
          { title: tx('অঙ্ক'), dataIndex: 'pad_length', render: (v) => (v ? digits(v) : tx('যত প্রয়োজন')) },
          { title: tx('পরবর্তী নম্বর'), dataIndex: 'next_value', render: digits },
          { title: tx('বছরে নতুন করে'), dataIndex: 'reset_yearly', render: (v) => (v ? <Tag color="blue">{tx('হ্যাঁ')}</Tag> : tx('না')) },
          { title: tx('নমুনা'), dataIndex: 'preview', render: (v) => <strong>{v}</strong> },
          { title: '', width: 100, render: (_, s) => <Button onClick={() => open(s)}>{tx('সম্পাদনা')}</Button> },
        ]}
      />
      <Modal open={!!editing} title={editing?.label} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="prefix" label="Prefix" extra={tx('{YYYY} লিখলে চলতি বছর বসবে।')}>
            <Input />
          </Form.Item>
          <Form.Item name="pad_length" label={tx('মোট অঙ্ক (০ = যত প্রয়োজন)')}>
            <InputNumber min={0} max={10} />
          </Form.Item>
          <Form.Item
            name="next_value"
            label={tx('পরবর্তী নম্বর')}
            rules={[{ validator: (_, v) => (v >= (editing?.next_value ?? 1) ? Promise.resolve() : Promise.reject(new Error(tx('পরবর্তী নম্বর কমানো যাবে না')))) }]}
          >
            <InputNumber min={1} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="reset_yearly" label={tx('প্রতি বছর ১ থেকে শুরু')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
