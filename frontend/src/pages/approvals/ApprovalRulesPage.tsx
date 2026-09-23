import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, InputNumber, Modal, Select, Space, Switch, Table, Tag } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { api, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import type { ApprovalRule } from '../../lib/types'

export default function ApprovalRulesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: roles } = useRoles()
  const [editing, setEditing] = useState<ApprovalRule | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['approval-rules'],
    queryFn: async () => (await api.get<ApprovalRule[]>('/approval-rules')).data,
  })

  const roleLabel = (n: string) => roles?.find((r) => r.name === n)?.label ?? n

  const open = (r: ApprovalRule) => {
    setEditing(r)
    form.setFieldsValue({ enabled: r.enabled, min_amount: r.min_amount ? Number(r.min_amount) : null, steps: r.steps.map((roles) => ({ roles })) })
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      await api.put(`/approval-rules/${editing!.id}`, {
        enabled: v.enabled,
        min_amount: v.min_amount ?? null,
        steps: (v.steps as { roles: string[] }[]).map((s) => s.roles),
      })
      message.success('সংরক্ষণ হয়েছে।')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['approval-rules'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>অনুমোদনের নিয়ম</h2>
      </div>
      <Table<ApprovalRule>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: 'কাজ', dataIndex: 'label', render: (v, r) => <Space orientation="vertical" size={0}>{v}<code style={{ fontSize: 12 }}>{r.action_key}</code></Space> },
          { title: 'চালু', dataIndex: 'enabled', render: (v) => (v ? <Tag color="green">হ্যাঁ</Tag> : <Tag>না</Tag>) },
          {
            title: 'ধাপ',
            dataIndex: 'steps',
            render: (steps: string[][]) =>
              steps.map((s, i) => (
                <div key={i}>
                  {digits(i + 1)}. {s.map(roleLabel).join(' / ')}
                </div>
              )),
          },
          { title: 'ন্যূনতম পরিমাণ', dataIndex: 'min_amount', render: (v) => (v ? `৳ ${digits(v)}` : '—') },
          { title: '', width: 100, render: (_, r) => <Button onClick={() => open(r)}>সম্পাদনা</Button> },
        ]}
      />
      <Modal open={!!editing} title={editing?.label} onCancel={() => setEditing(null)} onOk={save} okText="সংরক্ষণ" cancelText="বাতিল" forceRender width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="অনুমোদন লাগবে" valuePropName="checked">
            <Switch checkedChildren="হ্যাঁ" unCheckedChildren="না" />
          </Form.Item>
          <Form.List name="steps" rules={[{ validator: async (_, s) => (s?.length ? undefined : Promise.reject(new Error('কমপক্ষে একটি ধাপ দিন'))) }]}>
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((f, i) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item
                      name={[f.name, 'roles']}
                      label={`ধাপ ${digits(i + 1)}`}
                      rules={[{ required: true, type: 'array', min: 1, message: 'রোল দিন' }]}
                      style={{ minWidth: 380 }}
                    >
                      <Select
                        mode="multiple"
                        options={roleOptions(roles)}
                        placeholder="যেকোনো একজন অনুমোদন দিতে পারবেন"
                        showSearch={{ optionFilterProp: 'label' }}
                      />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="ধাপ সরান" />
                  </Space>
                ))}
                {fields.length < 3 && (
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ roles: [] })}>
                    ধাপ যোগ করুন
                  </Button>
                )}
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
          <Form.Item name="min_amount" label="এর কম পরিমাণ হলে অনুমোদন লাগবে না (ঐচ্ছিক)" style={{ marginTop: 16 }}>
            <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
