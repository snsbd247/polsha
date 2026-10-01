import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Grid, Input, Modal, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CopyOutlined, DeleteFilled, EditFilled, KeyOutlined, PlusOutlined, SafetyCertificateFilled, SearchOutlined, SettingFilled, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, toEnDigits } from '../../lib/format'
import { useRoles } from '../../lib/queries'
import { required } from '../../lib/rules'
import type { Role } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../accounting/accounting.css'

/** Roles and what each may do: add, rename, copy or remove a role and open its permission grid. */
export default function RoleListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const { data: roles, isLoading } = useRoles()
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [form] = Form.useForm()

  const all = roles ?? []
  const q = toEnDigits(search).toLowerCase()
  const rows = all.filter((r) => !q || `${r.label ?? ''} ${r.name} ${r.description ?? ''}`.toLowerCase().includes(q))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['roles'] })

  const openForm = (r: Role | 'new') => {
    setEditing(r)
    form.setFieldsValue(r === 'new' ? { label: '', description: '' } : r)
  }

  const save = async () => {
    const values = await form.validateFields()
    try {
      if (editing === 'new') await api.post('/roles', values)
      else await api.put(`/roles/${(editing as Role).id}`, values)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const duplicate = async (r: Role) => {
    try {
      await api.post(`/roles/${r.id}/duplicate`)
      message.success(tx('কপি তৈরি হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const remove = (r: Role) =>
    modal.confirm({
      title: tx('"{{p0}}" রোল মুছবেন?', { p0: r.label }),
      okText: tx('মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.delete(`/roles/${r.id}`)
          message.success(tx('মুছে ফেলা হয়েছে।'))
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const cards = [
    { key: 'total', label: tx('মোট রোল'), value: roles ? all.length : undefined, icon: '', glyph: <SafetyCertificateFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'system', label: tx('সিস্টেম রোল'), value: roles ? all.filter((r) => r.is_system).length : undefined, icon: '', glyph: <SettingFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'custom', label: tx('নিজস্ব রোল'), value: roles ? all.filter((r) => !r.is_system).length : undefined, icon: '', glyph: <UserAddOutlined />, color: '#f08c00', tint: '#fdefd6' },
    {
      key: 'users',
      label: tx('রোল দেওয়া ইউজার'),
      value: roles ? all.reduce((s, r) => s + Number(r.users_count), 0) : undefined,
      icon: '',
      glyph: <TeamOutlined />,
      color: '#1f9d55',
      tint: '#dcf3e5',
      onClick: () => navigate('/admin/users'),
    },
  ]

  const columns: ColumnsType<Role> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
    {
      title: tx('রোল'),
      dataIndex: 'label',
      render: (v: string | null, r) => (
        <span className="hs-two">
          <span className="mg-name">
            {v ?? r.name} {r.is_system && <Tag className="fl-tag ll-gray">{tx('সিস্টেম')}</Tag>}
          </span>
          <span>{r.name}</span>
        </span>
      ),
    },
    { title: tx('বিবরণ'), dataIndex: 'description', render: (v: string | null) => <span className="jl-narr">{v || '—'}</span> },
    { title: tx('ইউজার'), dataIndex: 'users_count', align: 'center', render: (v: number) => <Tag className={`fl-tag ${v ? 'll-blue' : 'll-gray'}`}>{digits(v)}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 210,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="fl-actions pl-actions">
          <Tooltip title={tx('অনুমতি')}>
            <Button className="fl-act pl-act" icon={<KeyOutlined />} aria-label={tx('অনুমতি')} onClick={() => navigate(`/admin/roles/${r.id}/permissions`)} />
          </Tooltip>
          {can('role.edit') && (
            <Tooltip title={tx('সম্পাদনা')}>
              <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => openForm(r)} />
            </Tooltip>
          )}
          {can('role.create') && (
            <Tooltip title={tx('কপি')}>
              <Button className="fl-act pl-act" icon={<CopyOutlined />} aria-label={tx('কপি')} onClick={() => duplicate(r)} />
            </Tooltip>
          )}
          {can('role.delete') && (
            <Tooltip title={r.is_system ? tx('সিস্টেম রোল মুছা যায় না') : r.users_count ? tx('এই রোলে ইউজার আছে') : tx('মুছুন')}>
              <Button className="fl-act pl-act" danger icon={<DeleteFilled />} aria-label={tx('মুছুন')} disabled={r.is_system || r.users_count > 0} onClick={() => remove(r)} />
            </Tooltip>
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('প্রশাসন'), to: '/admin/users' }}
      title={tx('রোল')}
      subtitle=""
      actions={
        <>
          <Button icon={<KeyOutlined />} onClick={() => navigate('/admin/permissions')}>
            {tx('অনুমতি')}
          </Button>
          {can('role.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm('new')}>
              {tx('নতুন রোল')}
            </Button>
          )}
        </>
      }
      cards={cards}
      filters={
        <Field label={tx('খুঁজুন')} grow={400}>
          <Input prefix={<SearchOutlined />} allowClear placeholder={tx('রোলের নাম বা বিবরণ...')} value={draft} onChange={(e) => setDraft(e.target.value)} onPressEnter={() => setSearch(draft)} />
        </Field>
      }
      onSearch={() => setSearch(draft)}
      onReset={() => {
        setDraft('')
        setSearch('')
      }}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('রোলের তালিকা'), p1: n0(rows.length) })}
    >
      <Table<Role>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('কোনো রোল পাওয়া যায়নি') }}
      />
      <Modal open={!!editing} title={editing === 'new' ? tx('নতুন রোল') : tx('রোল সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="label" label={tx('রোলের নাম')} rules={[required(tx('নাম দিন'))]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={tx('বিবরণ')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </ListFrame>
  )
}
