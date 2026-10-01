import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import type { AssetCategory } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

export default function AssetCategoriesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<AssetCategory | 'new' | null>(null)
  const [form] = Form.useForm()
  const { data, isLoading } = useQuery({ queryKey: ['asset-categories'], queryFn: async () => (await api.get<AssetCategory[]>('/asset-categories')).data })

  const open = (c: AssetCategory | 'new') => {
    setEditing(c)
    form.resetFields()
    form.setFieldsValue(c === 'new' ? { is_active: true, life_months: 60, salvage_percent: 0 } : { ...c, salvage_percent: Number(c.salvage_percent) })
  }
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      if (editing === 'new') await api.post('/asset-categories', v)
      else await api.put(`/asset-categories/${(editing as AssetCategory).id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['asset-categories'] })
      queryClient.invalidateQueries({ queryKey: ['asset-meta'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('সম্পদ'), to: '/assets/dashboard' }, { label: tx('সম্পদ রেজিস্টার'), to: '/assets' }, { label: tx('সম্পদের শ্রেণি') }]}
      title={tx('সম্পদের শ্রেণি')}
      actions={
        <span className="id-actions no-print">
          <Can perm="asset.admin">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              {tx('নতুন শ্রেণি')}
            </Button>
          </Can>
        </span>
      }
    >
      <Table<AssetCategory>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: tx('কোড'), dataIndex: 'code' },
          { title: tx('নাম'), render: (_, c) => nameOf(c) },
          { title: tx('আয়ুষ্কাল (মাস)'), dataIndex: 'life_months', render: digits },
          { title: tx('অবশিষ্ট মূল্য (%)'), dataIndex: 'salvage_percent', render: (v: string) => digits(Number(v)) },
          { title: tx('সম্পদ সংখ্যা'), dataIndex: 'assets_count', render: digits },
          { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v: boolean) => (v ? <Tag color="green">{tx('সক্রিয়')}</Tag> : <Tag>{tx('নিষ্ক্রিয়')}</Tag>) },
          {
            title: '',
            width: 100,
            render: (_, c) => (
              <Can perm="asset.admin">
                <Button onClick={() => open(c)}>{tx('সম্পাদনা')}</Button>
              </Can>
            ),
          },
        ]}
      />
      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন শ্রেণি') : tx('শ্রেণি সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label={tx('কোড')} rules={[required(tx('কোড দিন'))]}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="life_months" label={tx('আয়ুষ্কাল (মাস)')} rules={[required(tx('আয়ুষ্কাল দিন'))]} extra={tx('নতুন সম্পদে ডিফল্ট হিসেবে বসবে।')}>
            <InputNumber min={1} max={1200} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="salvage_percent" label={tx('অবশিষ্ট মূল্য (%)')} rules={[required(tx('হার দিন'))]}>
            <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
