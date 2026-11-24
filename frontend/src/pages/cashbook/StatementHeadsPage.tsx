import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, Modal, Segmented, Select, Switch, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteFilled, EditFilled, PlusOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { accountLabel, useAccountOptions } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { required } from '../../lib/rules'
import { t as tx } from '../../lib/i18n'
import './receipt-payment.css'

type Head = {
  id: number
  fund: string
  side: 'receipt' | 'payment'
  name_bn: string
  name_en: string | null
  kind: string | null
  sort_order: number
  is_active: boolean
  accounts: { id: number; code: string; name_bn: string }[]
}

const FUNDS = [
  { value: 'society', label: tx('সমিতি') },
  { value: 'irrigation', label: tx('সেচ') },
  { value: 'water', label: tx('ওয়াটার সাপ্লাই') },
]

/**
 * The lines of each fund's জমা-খরচ বিবরণী: their order, names and the ledger
 * accounts whose money each one shows. A head with no account prints empty.
 */
export default function StatementHeadsPage({ tabs }: { tabs?: ReactNode }) {
  const { message, modal } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [fund, setFund] = useState('society')
  const [editing, setEditing] = useState<Head | { side: 'receipt' | 'payment' } | null>(null)
  const [form] = Form.useForm()
  const canEdit = can('accounting.edit')
  const { data: accounts } = useAccountOptions()

  const { data, isFetching } = useQuery({ queryKey: ['statement-heads', fund], queryFn: async () => (await api.get<{ heads: Head[] }>('/statement-heads', { params: { fund } })).data })
  const heads = data?.heads ?? []
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['statement-heads'] })
    queryClient.invalidateQueries({ queryKey: ['receipt-payment'] })
  }

  const move = async (side: string, id: number, by: number) => {
    const ids = heads.filter((h) => h.side === side).map((h) => h.id)
    const i = ids.indexOf(id)
    const j = i + by
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try {
      await api.post('/statement-heads/reorder', { ids })
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const open = (h: Head | { side: 'receipt' | 'payment' }) => {
    setEditing(h)
    form.resetFields()
    form.setFieldsValue('id' in h ? { ...h, account_ids: h.accounts.map((a) => a.id) } : { is_active: true, account_ids: [] })
  }
  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing && 'id' in editing) await api.put(`/statement-heads/${editing.id}`, v)
      else await api.post('/statement-heads', { ...v, fund, side: editing?.side })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  const remove = (h: Head) =>
    modal.confirm({
      title: tx('"{{p0}}" খাতটি মুছে ফেলবেন?', { p0: h.name_bn }),
      content: tx('হিসাবগুলো মুছবে না; শুধু বিবরণী থেকে এই সারি সরবে। এর টাকা তখন হিসাবের নামে আলাদা সারিতে দেখাবে।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        await api.delete(`/statement-heads/${h.id}`)
        refresh()
      },
    })

  const columns = (side: 'receipt' | 'payment'): ColumnsType<Head> => [
    { title: tx('ক্রমিক'), width: 56, align: 'center', render: (_, __, i) => digits(i + 1) },
    {
      title: tx('খাতের নাম'),
      render: (_, h) => (
        <>
          <b>{h.name_bn}</b> {!h.is_active && <Tag>{tx('নিষ্ক্রিয়')}</Tag>}
          {h.kind === 'season' && <Tag color="green">{tx('মৌসুম অনুযায়ী আলাদা সারি')}</Tag>}
          <div className="rp-accts">
            {h.accounts.length ? h.accounts.map((a) => <Tag key={a.id}>{accountLabel(a)}</Tag>) : <span className="rp-noacct">{tx('কোনো হিসাব নেই — খালি সারি')}</span>}
          </div>
        </>
      ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            width: 150,
            align: 'right' as const,
            render: (_: unknown, h: Head) => (
              <span className="rp-actions">
                <Tooltip title={tx('উপরে')}>
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(side, h.id, -1)} />
                </Tooltip>
                <Tooltip title={tx('নিচে')}>
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(side, h.id, 1)} />
                </Tooltip>
                <Button size="small" type="text" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => open(h)} />
                <Button size="small" type="text" danger icon={<DeleteFilled />} aria-label={tx('মুছুন')} onClick={() => remove(h)} />
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <PageFrame crumbs={[{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }, { label: tx('জমা-খরচ বিবরণী'), to: '/cashbook/receipt-payment' }, { label: tx('খাত সাজান') }]} title={tx('খাত সাজান')}>
      {tabs}
      <div className="rp-bar">
        <Segmented value={fund} options={FUNDS} onChange={(v) => setFund(String(v))} />
        <span className="rp-hint">{tx('প্রতিটি খাতে যে হিসাবগুলোর টাকা দেখাবে সেগুলো বাছাই করুন। কোনো খাতে না থাকা হিসাবের টাকা হিসাবের নামে শেষে আলাদা সারিতে আসে।')}</span>
      </div>
      <div className="rp-heads">
        {(['receipt', 'payment'] as const).map((side) => (
          <section key={side}>
            <header>
              <h3>{side === 'receipt' ? tx('জমা') : tx('খরচ')}</h3>
              {canEdit && (
                <Button size="small" icon={<PlusOutlined />} onClick={() => open({ side })}>
                  {tx('নতুন খাত')}
                </Button>
              )}
            </header>
            <Table<Head> size="small" rowKey="id" loading={isFetching} pagination={false} dataSource={heads.filter((h) => h.side === side)} columns={columns(side)} />
          </section>
        ))}
      </div>
      <Modal open={!!editing} forceRender title={editing && 'id' in editing ? tx('খাত সম্পাদনা') : tx('নতুন খাত')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical">
          <Form.Item name="name_bn" label={tx('খাতের নাম')} rules={[required(tx('নাম দিন'))]}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="name_en" label={tx('খাতের নাম (English)')}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="account_ids" label={tx('হিসাব')} extra={tx('এই হিসাবগুলোর টাকা এই খাতে দেখাবে; একটি হিসাব একই দিকের একটিই খাতে থাকতে পারে।')}>
            <Select mode="multiple" showSearch={{ optionFilterProp: 'label' }} options={(accounts ?? []).map((a) => ({ value: a.id, label: accountLabel(a) }))} />
          </Form.Item>
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
          </Form.Item>
        </Form>
      </Modal>
    </PageFrame>
  )
}
