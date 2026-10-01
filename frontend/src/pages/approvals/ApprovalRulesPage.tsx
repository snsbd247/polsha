import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, InputNumber, Modal, Select, Space, Switch, Table, Tag } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { api, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import type { ApprovalRule } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

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
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['approval-rules'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <PageFrame className="ml pl" crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('অনুমোদন'), to: '/approvals' }, { label: tx('অনুমোদনের নিয়ম') }]} title={tx('অনুমোদনের নিয়ম')}>
      <Table<ApprovalRule>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          {
            title: tx('কাজ'),
            dataIndex: 'label',
            render: (v, r) => (
              <Space orientation="vertical" size={0}>
                {v}
                <code style={{ fontSize: 12 }}>{r.action_key}</code>
              </Space>
            ),
          },
          { title: tx('চালু'), dataIndex: 'enabled', render: (v) => (v ? <Tag color="green">{tx('হ্যাঁ')}</Tag> : <Tag>{tx('না')}</Tag>) },
          {
            title: tx('ধাপ'),
            dataIndex: 'steps',
            render: (steps: string[][]) =>
              steps.map((s, i) => (
                <div key={i}>
                  {digits(i + 1)}. {s.map(roleLabel).join(' / ')}
                </div>
              )),
          },
          { title: tx('ন্যূনতম পরিমাণ'), dataIndex: 'min_amount', render: (v) => (v ? tx('৳ {{p0}}', { p0: digits(v) }) : '—') },
          { title: '', width: 100, render: (_, r) => <Button onClick={() => open(r)}>{tx('সম্পাদনা')}</Button> },
        ]}
      />
      <Modal open={!!editing} title={editing?.label} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label={tx('অনুমোদন লাগবে')} valuePropName="checked">
            <Switch checkedChildren={tx('হ্যাঁ')} unCheckedChildren={tx('না')} />
          </Form.Item>
          <Form.List name="steps" rules={[{ validator: async (_, s) => (s?.length ? undefined : Promise.reject(new Error(tx('কমপক্ষে একটি ধাপ দিন')))) }]}>
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((f, i) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item name={[f.name, 'roles']} label={tx('ধাপ {{p0}}', { p0: digits(i + 1) })} rules={[{ required: true, type: 'array', min: 1, message: tx('রোল দিন') }]} style={{ minWidth: 380 }}>
                      <Select mode="multiple" options={roleOptions(roles)} placeholder={tx('যেকোনো একজন অনুমোদন দিতে পারবেন')} showSearch={{ optionFilterProp: 'label' }} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(f.name)} aria-label={tx('ধাপ সরান')} />
                  </Space>
                ))}
                {fields.length < 3 && (
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ roles: [] })}>
                    {tx('ধাপ যোগ করুন')}
                  </Button>
                )}
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
          <Form.Item name="min_amount" label={tx('এর কম পরিমাণ হলে অনুমোদন লাগবে না (ঐচ্ছিক)')} style={{ marginTop: 16 }}>
            <InputNumber min={0} style={{ width: '100%' }} prefix={tx('৳')} />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
