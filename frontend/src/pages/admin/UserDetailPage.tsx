import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, Descriptions, Space, Spin, Table, Tabs, Tag } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import type { AuditLog, UserRow } from '../../lib/types'

type LoginLog = { id: number; success: boolean; reason: string | null; ip_address: string | null; user_agent: string | null; created_at: string }

const REASONS: Record<string, string> = { wrong_password: 'ভুল পাসওয়ার্ড', locked: 'লক করা', inactive: 'নিষ্ক্রিয়', unknown_user: 'অজানা ইউজার' }

export default function UserDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [loginPage, setLoginPage] = useState(1)
  const [actPage, setActPage] = useState(1)

  const { data: user, isLoading } = useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api.get<UserRow>(`/users/${id}`)).data,
  })
  const logins = useQuery({
    queryKey: ['users', id, 'logins', loginPage],
    queryFn: async () => (await api.get<Paginated<LoginLog>>(`/users/${id}/login-logs`, { params: { page: loginPage } })).data,
    placeholderData: keepPreviousData,
  })
  const activity = useQuery({
    queryKey: ['users', id, 'activity', actPage],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/users/${id}/activity`, { params: { page: actPage } })).data,
    enabled: can('audit.view'),
    placeholderData: keepPreviousData,
  })

  if (isLoading || !user) return <Spin />

  return (
    <>
      <div className="page-header">
        <h2>{user.name_bn}</h2>
        <Can perm="user.edit">
          <Button icon={<EditOutlined />} onClick={() => navigate(`/admin/users/${user.id}/edit`)}>
            সম্পাদনা
          </Button>
        </Can>
      </div>
      <Card>
        <Tabs
          items={[
            {
              key: 'info',
              label: 'তথ্য',
              children: (
                <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
                  <Descriptions.Item label="নাম (বাংলা)">{user.name_bn}</Descriptions.Item>
                  <Descriptions.Item label="নাম (ইংরেজি)">{user.name_en ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="ইউজারনেম">{user.username}</Descriptions.Item>
                  <Descriptions.Item label="মোবাইল">{digits(user.mobile)}</Descriptions.Item>
                  <Descriptions.Item label="ইমেইল">{user.email ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="রোল">
                    {user.roles.map((r) => (
                      <Tag key={r.name}>{r.label ?? r.name}</Tag>
                    ))}
                  </Descriptions.Item>
                  <Descriptions.Item label="অবস্থা">
                    <Space>
                      {user.is_active ? <Tag color="green">সক্রিয়</Tag> : <Tag color="red">নিষ্ক্রিয়</Tag>}
                      {user.is_locked && <Tag color="orange">লক</Tag>}
                      {user.must_change_password && <Tag>পাসওয়ার্ড বদলানো বাকি</Tag>}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="শেষ লগইন">{fmtDateTime(user.last_login_at)}</Descriptions.Item>
                  <Descriptions.Item label="তৈরি">{fmtDateTime(user.created_at)}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'logins',
              label: 'লগইন ইতিহাস',
              children: (
                <Table<LoginLog>
                  rowKey="id"
                  size="small"
                  loading={logins.isFetching}
                  dataSource={logins.data?.data}
                  scroll={{ x: 600 }}
                  pagination={{ current: loginPage, pageSize: logins.data?.per_page, total: logins.data?.total, onChange: setLoginPage, showSizeChanger: false }}
                  columns={[
                    { title: 'সময়', dataIndex: 'created_at', render: fmtDateTime },
                    { title: 'ফলাফল', render: (_, l) => (l.success ? <Tag color="green">সফল</Tag> : <Tag color="red">{REASONS[l.reason ?? ''] ?? 'ব্যর্থ'}</Tag>) },
                    { title: 'IP', dataIndex: 'ip_address' },
                    { title: 'ডিভাইস', dataIndex: 'user_agent', ellipsis: true },
                  ]}
                />
              ),
            },
            ...(can('audit.view')
              ? [
                  {
                    key: 'activity',
                    label: 'কাজের ইতিহাস',
                    children: (
                      <AuditLogTable
                        data={activity.data}
                        loading={activity.isFetching}
                        page={actPage}
                        onPage={setActPage}
                        hideUser
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  )
}
