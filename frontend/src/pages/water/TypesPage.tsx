import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Drawer, Form, Input, InputNumber, Switch, Table } from 'antd'
import { AppstoreFilled, EditFilled, LinkOutlined, PlusOutlined, TeamOutlined, WarningFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import type { WaterType } from '../../lib/water'
import { ListCard, num, SummaryCards, WaterFrame } from './WaterList'

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

  const list = data ?? []
  const activeTypes = list.filter((x) => x.is_active)
  const activeConnections = list.reduce((s, x) => s + (x.active_count ?? 0), 0)
  const allConnections = list.reduce((s, x) => s + (x.connections_count ?? 0), 0)
  const noFee = activeTypes.filter((x) => Number(x.monthly_fee) <= 0).length
  // what one month brings in if every active connection pays its type's fee
  const monthly = list.reduce((s, x) => s + (x.active_count ?? 0) * Number(x.monthly_fee), 0)
  const cards = [
    { key: 'types', tone: 'blue' as const, icon: <AppstoreFilled />, label: tx('সংযোগের ধরনসমূহ'), value: num(list.length), sub: tx('{{p0}}টি সক্রিয়', { p0: num(activeTypes.length) }) },
    { key: 'active', tone: 'green' as const, icon: <LinkOutlined />, label: tx('চালু সংযোগ'), value: num(activeConnections), sub: tx('সব ধরন মিলিয়ে') },
    { key: 'all', tone: 'purple' as const, icon: <TeamOutlined />, label: tx('মোট সংযোগ'), value: num(allConnections), sub: tx('বিচ্ছিন্ন ও বন্ধ সহ') },
    { key: 'monthly', tone: 'orange' as const, icon: <span className="wcl-taka">৳</span>, label: tx('মাসিক বিল (আনুমানিক)'), value: `৳ ${num(monthly)}`, sub: tx('চালু সংযোগ × মাসিক ফি') },
    { key: 'nofee', tone: 'red' as const, icon: <WarningFilled />, label: tx('ফি ঠিক করা নেই'), value: num(noFee), sub: noFee ? tx('এগুলোর বিল হবে না') : tx('সব ধরনের ফি ঠিক আছে') },
  ]

  return (
    <WaterFrame crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('সংযোগের ধরন ও মাসিক ফি') }]}>
      <SummaryCards cards={cards} />
      <ListCard
        title={
          <>
            <AppstoreFilled /> {tx('সংযোগের ধরন ও মাসিক ফি')}
          </>
        }
        actions={
          admin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              {tx('নতুন ধরন')}
            </Button>
          )
        }
      >
        <p className="wcl-modal-note">{tx('প্রতিটি ধরনের নির্দিষ্ট মাসিক বিল। ফি বদলালে পরের মাসের বিল থেকে নতুন ফি লাগে; আগের বিল বদলায় না।')}</p>
        <Table<WaterType>
          className="wcl-table"
          rowKey="id"
          loading={isLoading}
          dataSource={list}
          pagination={false}
          scroll={{ x: 820 }}
          columns={[
            { title: '#', width: 52, render: (_, __, i) => digits(i + 1) },
            { title: tx('কোড'), dataIndex: 'code', width: 90 },
            { title: tx('ধরন'), render: (_, x) => <b>{nameOf(x)}</b> },
            {
              title: tx('মাসিক ফি'),
              dataIndex: 'monthly_fee',
              width: 130,
              align: 'right',
              render: (v) => (Number(v) > 0 ? <strong>৳ {money(v)}</strong> : <span className="wcl-tag wcl-tag-amber">{tx('ঠিক করা নেই')}</span>),
            },
            { title: tx('সংযোগ ফি'), dataIndex: 'connection_fee', width: 120, align: 'right', render: (v) => `৳ ${money(v)}` },
            { title: tx('চালু সংযোগ'), dataIndex: 'active_count', width: 120, align: 'center', render: (v: number) => <span className="wcl-count wcl-count-ok">{digits(v ?? 0)}</span> },
            { title: tx('মোট সংযোগ'), dataIndex: 'connections_count', width: 110, align: 'center', render: (v: number) => digits(v ?? 0) },
            {
              title: tx('অবস্থা'),
              dataIndex: 'is_active',
              width: 110,
              render: (v: boolean) => <span className={`wcl-tag wcl-tag-${v ? 'green' : 'grey'}`}>{v ? tx('সক্রিয়') : tx('নিষ্ক্রিয়')}</span>,
            },
            {
              title: tx('কাজ'),
              width: 80,
              className: 'wcl-actcol',
              render: (_, x) =>
                admin ? (
                  <button type="button" className="wcl-act wcl-act-edit" aria-label={tx('সম্পাদনা')} title={tx('সম্পাদনা')} onClick={() => open(x)}>
                    <EditFilled />
                  </button>
                ) : null,
            },
          ]}
        />
      </ListCard>
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
    </WaterFrame>
  )
}
