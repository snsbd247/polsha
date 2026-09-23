import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, Input, Select, Space, Table, Tag } from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import ResetPasswordModal from '../../components/ResetPasswordModal'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import type { UserRow } from '../../lib/types'

export default function UserListPage() {
  const navigate = useNavigate()
  const { user: me, can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data: roles } = useRoles()
  const [params, setParams] = useState({ page: 1, per_page: 25, search: '', role: undefined as string | undefined, is_active: undefined as string | undefined })
  const [resetFor, setResetFor] = useState<UserRow | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['users', params],
    queryFn: async () => (await api.get<Paginated<UserRow>>('/users', { params })).data,
    placeholderData: keepPreviousData,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const toggle = (u: UserRow) =>
    modal.confirm({
      title: u.is_active ? `${u.name_bn}-কে নিষ্ক্রিয় করবেন?` : `${u.name_bn}-কে সক্রিয় করবেন?`,
      content: u.is_active ? 'নিষ্ক্রিয় করলে ইউজার সঙ্গে সঙ্গে লগআউট হয়ে যাবে।' : undefined,
      okText: 'হ্যাঁ',
      cancelText: 'না',
      onOk: async () => {
        try {
          await api.post(`/users/${u.id}/toggle-active`)
          message.success('সম্পন্ন হয়েছে।')
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const forceLogout = async (u: UserRow) => {
    try {
      const r = await api.post(`/users/${u.id}/force-logout`)
      message.success(r.data.message)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>ইউজার</h2>
        <Can perm="user.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/users/new')}>
            নতুন ইউজার
          </Button>
        </Can>
      </div>

      <div className="toolbar">
        <Input.Search
          placeholder="নাম, ইউজারনেম বা মোবাইল"
          allowClear
          style={{ width: 280 }}
          onSearch={(search) => setParams((p) => ({ ...p, search, page: 1 }))}
        />
        <Select
          placeholder="রোল"
          allowClear
          style={{ width: 180 }}
          options={roleOptions(roles)}
          onChange={(role) => setParams((p) => ({ ...p, role, page: 1 }))}
        />
        <Select
          placeholder="অবস্থা"
          allowClear
          style={{ width: 140 }}
          options={[
            { value: '1', label: 'সক্রিয়' },
            { value: '0', label: 'নিষ্ক্রিয়' },
          ]}
          onChange={(is_active) => setParams((p) => ({ ...p, is_active, page: 1 }))}
        />
      </div>

      <Table<UserRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 800 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          pageSizeOptions: [25, 50, 100],
          showSizeChanger: true,
          showTotal: (t) => `মোট ${digits(t)} জন`,
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'নাম', dataIndex: 'name_bn', render: (v, u) => <Link to={`/admin/users/${u.id}`}>{v}</Link> },
          { title: 'ইউজারনেম', dataIndex: 'username' },
          { title: 'মোবাইল', dataIndex: 'mobile', render: digits },
          { title: 'রোল', dataIndex: 'roles', render: (rs: UserRow['roles']) => rs.map((r) => <Tag key={r.name}>{r.label ?? r.name}</Tag>) },
          {
            title: 'অবস্থা',
            render: (_, u) => (
              <Space size={4} wrap>
                {u.is_active ? <Tag color="green">সক্রিয়</Tag> : <Tag color="red">নিষ্ক্রিয়</Tag>}
                {u.is_locked && <Tag color="orange">লক</Tag>}
              </Space>
            ),
          },
          { title: 'শেষ লগইন', dataIndex: 'last_login_at', render: fmtDateTime },
          {
            title: '',
            width: 48,
            render: (_, u) => {
              const items = [
                can('user.edit') && { key: 'edit', label: 'সম্পাদনা', onClick: () => navigate(`/admin/users/${u.id}/edit`) },
                can('user.edit') && u.id !== me?.id && { key: 'toggle', label: u.is_active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন', onClick: () => toggle(u) },
                can('user.admin') && { key: 'reset', label: 'পাসওয়ার্ড রিসেট', onClick: () => setResetFor(u) },
                can('user.admin') && { key: 'logout', label: 'জোর করে লগআউট', onClick: () => forceLogout(u) },
              ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
              return items.length ? (
                <Dropdown menu={{ items }} trigger={['click']}>
                  <Button type="text" icon={<MoreOutlined />} aria-label="আরও" />
                </Dropdown>
              ) : null
            },
          },
        ]}
      />
      <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />
    </>
  )
}
