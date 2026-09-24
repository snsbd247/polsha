import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { ACCOUNT_TYPE_LABEL, accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

type Account = {
  id: number
  key: string | null
  code: string
  name_bn: string
  name_en: string | null
  type: string
  parent_id: number | null
  is_postable: boolean
  is_system: boolean
  is_active: boolean
  is_fund: boolean
  description: string | null
  balance: number
  lines_count: number
  children?: Account[]
}

export default function ChartOfAccountsPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [form] = Form.useForm()
  const type = Form.useWatch('type', form)

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get<{ data: Account[] }>('/accounts')).data.data,
  })

  // Group headers show the rolled-up balance of everything under them.
  const tree = useMemo(() => {
    const byId = new Map<number, Account>()
    ;(data ?? []).forEach((a) => byId.set(a.id, { ...a, children: [] }))
    const roots: Account[] = []
    byId.forEach((a) => {
      const parent = a.parent_id ? byId.get(a.parent_id) : undefined
      if (parent) parent.children!.push(a)
      else roots.push(a)
    })
    const roll = (a: Account): number => {
      if (!a.children!.length) {
        delete a.children
        return a.balance
      }
      a.balance = a.balance + a.children!.reduce((s, c) => s + roll(c), 0)
      return a.balance
    }
    roots.forEach(roll)
    return roots
  }, [data])

  const q = search.trim().toLowerCase()
  const flat = q ? (data ?? []).filter((a) => `${a.code} ${a.name_bn} ${a.name_en ?? ''}`.toLowerCase().includes(q)) : null

  const groups = (data ?? []).filter((a) => !a.is_postable && (!type || a.type === type) && a.id !== (editing as Account | null)?.id)

  const open = (a: Account | 'new', parent?: Account) => {
    setEditing(a)
    form.resetFields()
    form.setFieldsValue(a === 'new' ? { is_postable: true, is_active: true, type: parent?.type, parent_id: parent?.id } : a)
  }

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/accounts', v)
      else await api.put(`/accounts/${(editing as Account).id}`, v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['account-options'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const remove = async (a: Account) => {
    try {
      await api.delete(`/accounts/${a.id}`)
      message.success(tx('মুছে ফেলা হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['account-options'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const sys = editing !== 'new' && editing?.is_system

  return (
    <>
      <div className="page-header">
        <h2>{tx('হিসাবের তালিকা (Chart of Accounts)')}</h2>
        <Can perm="accounting.edit">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন হিসাব')}
          </Button>
        </Can>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('কোড বা নাম')} allowClear style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Table<Account>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={flat ?? tree}
        pagination={false}
        scroll={{ x: 800 }}
        expandable={{ defaultExpandAllRows: true }}
        key={data ? 'loaded' : 'loading'}
        columns={[
          { title: tx('কোড'), dataIndex: 'code', width: 140, render: digits },
          {
            title: tx('হিসাবের নাম'),
            render: (_, a) => (
              <Space size={4} wrap>
                {a.is_postable ? <Link to={`/accounting/ledger?account_id=${a.id}`}>{nameOf(a)}</Link> : <b>{nameOf(a)}</b>}
                {a.is_fund && <Tag color="blue">{tx('নগদ/ব্যাংক')}</Tag>}
                {!a.is_postable && <Tag>{tx('গ্রুপ')}</Tag>}
                {!a.is_active && <Tag color="red">{tx('নিষ্ক্রিয়')}</Tag>}
              </Space>
            ),
          },
          { title: tx('ধরন'), dataIndex: 'type', width: 130, render: (t: string) => ACCOUNT_TYPE_LABEL[t] ?? t },
          { title: tx('জের (টাকা)'), dataIndex: 'balance', width: 150, align: 'right', render: (v: number, a) => (a.is_postable ? money(v) : <b>{money(v)}</b>) },
          {
            title: '',
            width: 190,
            render: (_, a) =>
              can('accounting.edit') && (
                <Space size={4}>
                  {!a.is_postable && (
                    <Button size="small" onClick={() => open('new', a)}>
                      {tx('উপ-হিসাব')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => open(a)}>
                    {tx('সম্পাদনা')}
                  </Button>
                  {!a.is_system && !a.lines_count && !a.children?.length && !a.is_fund && (
                    <Popconfirm title={tx('হিসাবটি মুছে ফেলবেন?')} okText={tx('হ্যাঁ')} cancelText={tx('না')} onConfirm={() => remove(a)}>
                      <Button size="small" danger>
                        {tx('মুছুন')}
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
          },
        ]}
      />

      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন হিসাব') : tx('হিসাব সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        {sys && <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('এটি সিস্টেম হিসাব; শুধু নাম ও বিবরণ বদলানো যাবে।')} />}
        <Form form={form} layout="vertical">
          <Form.Item name="code" label={tx('কোড')} rules={[required(tx('কোড দিন'))]} extra={tx('যেমন: ৫১১০ (ইংরেজি অঙ্কে)')}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="type" label={tx('ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
            <Select disabled={!!sys} options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="parent_id" label={tx('মূল হিসাব (গ্রুপ)')}>
            <Select allowClear disabled={!!sys} options={groups.map((g) => ({ value: g.id, label: accountLabel(g) }))} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="is_postable" label={tx('লেনদেনযোগ্য')} valuePropName="checked" tooltip={tx('বন্ধ থাকলে এটি শুধু গ্রুপ; সরাসরি এন্ট্রি হবে না')}>
              <Switch disabled={!!sys} />
            </Form.Item>
            <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
              <Switch disabled={!!sys} checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label={tx('বিবরণ')}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
