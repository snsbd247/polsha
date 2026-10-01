import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Result, Spin, Table, Tabs, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarFilled, EditOutlined, HistoryOutlined, LoginOutlined, MailFilled, PhoneFilled, SafetyCertificateFilled, UserOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import type { AuditLog, UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { initials } from '../lands/ListFrame'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'
import '../accounting/accounting.css'

type LoginLog = { id: number; success: boolean; reason: string | null; ip_address: string | null; user_agent: string | null; created_at: string }

const REASONS: Record<string, string> = { wrong_password: tx('ভুল পাসওয়ার্ড'), locked: tx('লক করা'), inactive: tx('নিষ্ক্রিয়'), unknown_user: tx('অজানা ইউজার') }

/** One staff account: identity, roles and status, its sign-ins and (for auditors) everything it changed. */
export default function UserDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [loginPage, setLoginPage] = useState(1)
  const [actPage, setActPage] = useState(1)

  const {
    data: user,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api.get<UserRow>(`/users/${id}`)).data,
    retry: false,
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

  if (isError) return <Result status="404" title={tx('ইউজার পাওয়া যায়নি')} extra={<Button onClick={() => navigate('/admin/users')}>{tx('তালিকায় ফিরুন')}</Button>} />
  if (isLoading || !user) return <Spin />

  return (
    <PageFrame
      className="id-page ln-page"
      crumbs={[{ label: tx('প্রশাসন'), to: '/admin/users' }, { label: tx('ইউজার'), to: '/admin/users' }, { label: tx('ইউজারের বিস্তারিত') }]}
      title={tx('ইউজারের বিস্তারিত')}
      actions={
        <span className="id-actions">
          {can('user.edit') && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/admin/users/${user.id}/edit`)}>
              {tx('সম্পাদনা')}
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/admin/users')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon ud-initials">{initials(user.name_bn)}</span>
          <div>
            <small>{user.username}</small>
            <strong>{user.name_bn}</strong>
            <span className="coa-name">
              {user.is_active ? <Tag className="fl-tag fl-tag-green">● {tx('সক্রিয়')}</Tag> : <Tag className="fl-tag ll-gray">● {tx('নিষ্ক্রিয়')}</Tag>}
              {user.is_locked && <Tag className="fl-tag fl-tag-red">{tx('লক')}</Tag>}
            </span>
          </div>
        </div>
        <Fact icon={<SafetyCertificateFilled />} label={tx('রোল')} color="#8b3fe0" tint="#efe4fc">
          <strong>{user.roles.map((r) => r.label ?? r.name).join(', ') || '—'}</strong>
        </Fact>
        <Fact icon={<PhoneFilled />} label={tx('মোবাইল')} color="#1769e0" tint="#e4edfd">
          <strong>{user.mobile ? digits(user.mobile) : '—'}</strong>
        </Fact>
        <Fact icon={<LoginOutlined />} label={tx('শেষ লগইন')} color="#1f9d55" tint="#dcf3e5">
          <strong>{user.last_login_at ? fmtDate(user.last_login_at) : '—'}</strong>
        </Fact>
        <Fact icon={<CalendarFilled />} label={tx('তৈরি')} color="#f08c00" tint="#fdefd6">
          <strong>{fmtDate(user.created_at)}</strong>
        </Fact>
      </div>

      <div className="id-two">
        <Box icon={<UserOutlined />} title={tx('ইউজারের তথ্য')}>
          <KV
            rows={[
              [tx('নাম (বাংলা)'), user.name_bn],
              [tx('নাম (ইংরেজি)'), user.name_en || '—'],
              [tx('ইউজারনেম'), user.username],
              [tx('মোবাইল'), user.mobile ? digits(user.mobile) : '—'],
            ]}
          />
        </Box>
        <Box icon={<MailFilled />} title={tx('অ্যাকাউন্ট')}>
          <KV
            rows={[
              [tx('ইমেইল'), user.email || '—'],
              [
                tx('রোল'),
                user.roles.length
                  ? user.roles.map((r) => (
                      <Tag key={r.name} className="fl-tag ll-blue">
                        {r.label ?? r.name}
                      </Tag>
                    ))
                  : '—',
              ],
              [tx('পাসওয়ার্ড'), user.must_change_password ? <Tag className="fl-tag fl-tag-gold">{tx('পাসওয়ার্ড বদলানো বাকি')}</Tag> : tx('ঠিক আছে')],
              [tx('অবস্থা'), user.is_active ? tx('সক্রিয়') : tx('নিষ্ক্রিয়')],
            ]}
          />
        </Box>
      </div>

      <Box icon={<HistoryOutlined />} title={tx('ইতিহাস')} className="ln-tabs-box">
        <Tabs
          className="ln-tabs"
          items={[
            {
              key: 'logins',
              label: tx('লগইন ইতিহাস'),
              children: (
                <Table<LoginLog>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  loading={logins.isFetching}
                  dataSource={logins.data?.data}
                  scroll={{ x: 'max-content' }}
                  pagination={{ current: loginPage, pageSize: logins.data?.per_page, total: logins.data?.total, onChange: setLoginPage, showSizeChanger: false, hideOnSinglePage: true }}
                  locale={{ emptyText: tx('কোনো লগইন নেই') }}
                  columns={[
                    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
                    { title: tx('ফলাফল'), render: (_, l) => (l.success ? <Tag className="fl-tag fl-tag-green">{tx('সফল')}</Tag> : <Tag className="fl-tag fl-tag-red">{REASONS[l.reason ?? ''] ?? tx('ব্যর্থ')}</Tag>) },
                    { title: 'IP', dataIndex: 'ip_address', render: (v: string | null) => v || '—' },
                    { title: tx('ডিভাইস'), dataIndex: 'user_agent', render: (v: string | null) => <span className="jl-narr">{v || '—'}</span> },
                  ]}
                />
              ),
            },
            ...(can('audit.view')
              ? [
                  {
                    key: 'activity',
                    label: tx('কাজের ইতিহাস'),
                    children: <AuditLogTable data={activity.data} loading={activity.isFetching} page={actPage} onPage={setActPage} hideUser />,
                  },
                ]
              : []),
          ]}
        />
      </Box>
    </PageFrame>
  )
}
