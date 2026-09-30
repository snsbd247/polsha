import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Grid, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BankFilled, BookOutlined, DeleteFilled, EditFilled, FileTextFilled, PlusOutlined, RiseOutlined, SafetyCertificateFilled, SearchOutlined, TableOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { ACCOUNT_TYPE_LABEL, accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import './accounting.css'

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
type Filters = { search?: string; type?: string; kind?: string; active?: string }

const TYPE_TONE: Record<string, string> = { asset: 'll-blue', liability: 'll-orange', equity: 'll-purple', income: 'fl-tag-green', expense: 'fl-tag-red' }

/** The chart of accounts as a tree (groups show the rolled-up balance), with add / edit / remove. */
export default function ChartOfAccountsPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
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

  const postable = (data ?? []).filter((a) => a.is_postable)
  const sumOf = (t: string) => postable.filter((a) => a.type === t).reduce((s, a) => s + Number(a.balance), 0)
  const q = (filters.search ?? '').trim().toLowerCase()
  const filtering = !!(q || filters.type || filters.kind || filters.active)
  const flat = filtering
    ? (data ?? []).filter(
        (a) =>
          (!q || `${a.code} ${a.name_bn} ${a.name_en ?? ''}`.toLowerCase().includes(q)) &&
          (!filters.type || a.type === filters.type) &&
          (!filters.kind || (filters.kind === 'group' ? !a.is_postable : filters.kind === 'fund' ? a.is_fund : a.is_postable)) &&
          (!filters.active || String(a.is_active) === filters.active),
      )
    : null

  const groups = (data ?? []).filter((a) => !a.is_postable && (!type || a.type === type) && a.id !== (editing as Account | null)?.id)
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
  }

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
  const amt = (v: number) => (data ? `৳ ${money(v)}` : undefined)

  const cards = [
    { key: 'count', label: tx('মোট হিসাব · {{p0}}টি লেনদেনযোগ্য', { p0: n0(postable.length) }), value: data?.length, icon: '', glyph: <FileTextFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'asset', label: tx('সম্পদ'), value: amt(sumOf('asset')), icon: '', glyph: <BankFilled />, color: '#0e9f9a', tint: '#d9f4f2', onClick: () => show({ type: 'asset' }) },
    { key: 'liab', label: tx('দায় + মূলধন'), value: amt(sumOf('liability') + sumOf('equity')), icon: '', glyph: <SafetyCertificateFilled />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => show({ type: 'liability' }) },
    { key: 'net', label: tx('আয় − ব্যয় (চলতি)'), value: amt(sumOf('income') - sumOf('expense')), icon: '', glyph: <RiseOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ type: 'income' }) },
  ]

  const columns: ColumnsType<Account> = [
    { title: tx('কোড'), dataIndex: 'code', render: (v: string, a) => <span className={a.is_postable ? 'iv-no' : 'iv-no ac-strong'}>{digits(v)}</span> },
    {
      title: tx('হিসাবের নাম'),
      render: (_, a) => (
        <span className="coa-name">
          {a.is_postable ? (
            <Link to={`/accounting/ledger?account_id=${a.id}`} className="fl-link">
              {nameOf(a)}
            </Link>
          ) : (
            <strong>{nameOf(a)}</strong>
          )}
          {a.is_fund && <Tag className="fl-tag ll-blue">{tx('নগদ/ব্যাংক')}</Tag>}
          {!a.is_postable && <Tag className="fl-tag ll-gray">{tx('গ্রুপ')}</Tag>}
          {!a.is_active && <Tag className="fl-tag fl-tag-red">{tx('নিষ্ক্রিয়')}</Tag>}
        </span>
      ),
    },
    { title: tx('ধরন'), dataIndex: 'type', render: (t: string) => <Tag className={`fl-tag ${TYPE_TONE[t] ?? 'll-gray'}`}>{ACCOUNT_TYPE_LABEL[t] ?? t}</Tag> },
    { title: tx('জের (৳)'), dataIndex: 'balance', align: 'right', render: (v: number, a) => (a.is_postable ? money(v) : <strong>{money(v)}</strong>) },
    {
      title: tx('অ্যাকশন'),
      width: 170,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, a) => (
        <div className="fl-actions pl-actions">
          {a.is_postable && <Button className="fl-act pl-act" icon={<BookOutlined />} aria-label={tx('খতিয়ান')} title={tx('খতিয়ান')} onClick={() => navigate(`/accounting/ledger?account_id=${a.id}`)} />}
          {can('accounting.edit') && (
            <>
              {!a.is_postable && <Button className="fl-act pl-act" icon={<PlusOutlined />} aria-label={tx('উপ-হিসাব')} title={tx('উপ-হিসাব')} onClick={() => open('new', a)} />}
              <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} title={tx('সম্পাদনা')} onClick={() => open(a)} />
              {!a.is_system && !a.lines_count && !a.children?.length && !a.is_fund && (
                <Popconfirm title={tx('হিসাবটি মুছে ফেলবেন?')} okText={tx('হ্যাঁ')} cancelText={tx('না')} onConfirm={() => remove(a)}>
                  <Button className="fl-act pl-act" danger icon={<DeleteFilled />} aria-label={tx('মুছুন')} title={tx('মুছুন')} />
                </Popconfirm>
              )}
            </>
          )}
        </div>
      ),
    },
  ]
  const opts = (m: Record<string, string>) => [{ value: '', label: tx('সকল') }, ...Object.entries(m).map(([value, label]) => ({ value, label }))]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('হিসাবের তালিকা')}
      subtitle=""
      actions={
        <>
          <Button icon={<TableOutlined />} onClick={() => navigate('/accounting/trial-balance')}>
            {tx('রেওয়ামিল')}
          </Button>
          {can('accounting.edit') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              {tx('নতুন হিসাব')}
            </Button>
          )}
        </>
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={280}>
            <Input prefix={<SearchOutlined />} allowClear placeholder={tx('কোড বা নাম...')} value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))} onPressEnter={() => setFilters(draft)} />
          </Field>
          <Field label={tx('ধরন')}>
            <Select value={draft.type ?? ''} options={opts(ACCOUNT_TYPE_LABEL)} onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))} />
          </Field>
          <Field label={tx('হিসাবের রকম')}>
            <Select value={draft.kind ?? ''} options={opts({ postable: tx('লেনদেনযোগ্য'), group: tx('গ্রুপ'), fund: tx('নগদ/ব্যাংক') })} onChange={(v) => setDraft((d) => ({ ...d, kind: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.active ?? ''} options={opts({ true: tx('সক্রিয়'), false: tx('নিষ্ক্রিয়') })} onChange={(v) => setDraft((d) => ({ ...d, active: v || undefined }))} />
          </Field>
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: filtering ? tx('খোঁজার ফলাফল') : tx('হিসাবের গাছ'), p1: n0(flat ? flat.length : (data?.length ?? 0)) })}
    >
      <Table<Account>
        className="fl-table ml-table pl-table iv-table"
        rowKey="id"
        loading={isLoading}
        dataSource={flat ?? tree}
        pagination={false}
        scroll={{ x: 'max-content' }}
        expandable={{ defaultExpandAllRows: true }}
        rowClassName={(a) => (a.is_postable ? '' : 'coa-group')}
        key={data ? 'loaded' : 'loading'}
        columns={columns}
        locale={{ emptyText: tx('কোনো হিসাব পাওয়া যায়নি') }}
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
    </ListFrame>
  )
}
