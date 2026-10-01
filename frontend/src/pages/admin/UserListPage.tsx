import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, Grid, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, EditFilled, EyeFilled, LockFilled, LoginOutlined, MoreOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import ResetPasswordModal from '../../components/ResetPasswordModal'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { roleOptions, useRoles } from '../../lib/queries'
import type { UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../accounting/accounting.css'

type Resp = Paginated<UserRow> & { counts: { total: number; active: number; locked: number; today: number } }
type Filters = { search?: string; role?: string; is_active?: string }

/** Staff accounts: roles, status, last login; enable/disable, reset password or sign out from the row. */
export default function UserListPage() {
  const navigate = useNavigate()
  const { user: me, can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const { data: roles } = useRoles()
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [resetFor, setResetFor] = useState<UserRow | null>(null)

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['users', params],
    queryFn: async () => (await api.get<Resp>('/users', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setPage(1)
  }

  const toggle = (u: UserRow) =>
    modal.confirm({
      title: u.is_active ? tx('{{p0}}-কে নিষ্ক্রিয় করবেন?', { p0: u.name_bn }) : tx('{{p0}}-কে সক্রিয় করবেন?', { p0: u.name_bn }),
      content: u.is_active ? tx('নিষ্ক্রিয় করলে ইউজার সঙ্গে সঙ্গে লগআউট হয়ে যাবে।') : undefined,
      okText: tx('হ্যাঁ'),
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.post(`/users/${u.id}/toggle-active`)
          message.success(tx('সম্পন্ন হয়েছে।'))
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

  const cards = [
    { key: 'total', label: tx('মোট ইউজার'), value: c?.total, icon: '', glyph: <TeamOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'active', label: tx('সক্রিয়'), value: c?.active, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ is_active: '1' }) },
    { key: 'locked', label: tx('লক হয়ে আছে'), value: c?.locked, icon: '', glyph: <LockFilled />, color: '#e5383b', tint: '#fde4e5' },
    { key: 'today', label: tx('আজ লগইন করেছেন'), value: c?.today, icon: '', glyph: <LoginOutlined />, color: '#8b3fe0', tint: '#efe4fc' },
  ]

  const columns: ColumnsType<UserRow> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    {
      title: tx('নাম'),
      render: (_, u) => (
        <span className="mg-who">
          <span className="ml-initials mg-initials">{initials(u.name_bn)}</span>
          <span className="hs-two">
            <Link to={`/admin/users/${u.id}`} className="mg-name">
              {u.name_bn}
            </Link>
            <span>{u.username}</span>
          </span>
        </span>
      ),
    },
    { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v: string | null) => (v ? digits(v) : '—') },
    {
      title: tx('রোল'),
      dataIndex: 'roles',
      render: (rs: UserRow['roles']) =>
        rs.length
          ? rs.map((r) => (
              <Tag key={r.name} className="fl-tag ll-blue">
                {r.label ?? r.name}
              </Tag>
            ))
          : '—',
    },
    {
      title: tx('অবস্থা'),
      render: (_, u) => (
        <span className="coa-name">
          {u.is_active ? <Tag className="fl-tag iv-status fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag iv-status ll-gray">{tx('নিষ্ক্রিয়')}</Tag>}
          {u.is_locked && <Tag className="fl-tag fl-tag-red">{tx('লক')}</Tag>}
        </span>
      ),
    },
    { title: tx('শেষ লগইন'), dataIndex: 'last_login_at', render: (v: string | null) => (v ? fmtDateTime(v) : '—') },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, u) => {
        const items = [
          can('user.edit') && u.id !== me?.id && { key: 'toggle', label: u.is_active ? tx('নিষ্ক্রিয় করুন') : tx('সক্রিয় করুন'), onClick: () => toggle(u) },
          can('user.admin') && { key: 'reset', label: tx('পাসওয়ার্ড রিসেট'), onClick: () => setResetFor(u) },
          can('user.admin') && { key: 'logout', label: tx('জোর করে লগআউট'), onClick: () => forceLogout(u) },
        ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
        return (
          <div className="fl-actions pl-actions">
            <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/admin/users/${u.id}`)} />
            {can('user.edit') && <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => navigate(`/admin/users/${u.id}/edit`)} />}
            {items.length > 0 && (
              <Dropdown menu={{ items }} trigger={['click']}>
                <Button className="fl-act pl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
              </Dropdown>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('প্রশাসন'), to: '/admin/users' }}
      title={tx('ইউজার')}
      subtitle=""
      actions={
        can('user.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/users/new')}>
            {tx('নতুন ইউজার')}
          </Button>
        )
      }
      cards={cards}
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={320}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('নাম, ইউজারনেম বা মোবাইল...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => (setFilters(draft), setPage(1))}
            />
          </Field>
          <Field label={tx('রোল')}>
            <Select value={draft.role ?? ''} options={[{ value: '', label: tx('সকল') }, ...roleOptions(roles)]} onChange={(v) => setDraft((d) => ({ ...d, role: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.is_active ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: '1', label: tx('সক্রিয়') },
                { value: '0', label: tx('নিষ্ক্রিয়') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, is_active: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setFilters(draft)
        setPage(1)
      }}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('ইউজারের তালিকা'), p1: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<UserRow>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো ইউজার পাওয়া যায়নি') }}
      />
      <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />
    </ListFrame>
  )
}
