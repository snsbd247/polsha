import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Select, Spin, Table } from 'antd'
import { AppstoreFilled, CheckOutlined, EditFilled, KeyOutlined, SafetyCertificateFilled, SaveOutlined, TeamOutlined, UndoOutlined } from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { useRoles } from '../../lib/queries'
import type { Role } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import { StatRow } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../irrigation/invoice-detail.css'
import '../loans/loans.css'
import '../accounting/accounting.css'

type MatrixData = {
  role: Role
  modules: Record<string, string>
  actions: Record<string, string>
  granted: string[]
  locked: boolean
}

const crumbs = (last?: string) => [{ label: tx('প্রশাসন'), to: '/admin/users' }, { label: tx('রোল'), to: '/admin/roles' }, { label: last ?? tx('অনুমতি') }]

/** What each role may do: a module × action grid of checkboxes (whole rows and columns can be ticked at once). */
export default function PermissionMatrixPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const roles = useRoles()
  const { data, isLoading } = useQuery({
    queryKey: ['roles', id, 'permissions'],
    queryFn: async () => (await api.get<MatrixData>(`/roles/${id}/permissions`)).data,
    enabled: !!id,
  })

  // Opened from the menu without a role: pick one first.
  if (!id)
    return (
      <PageFrame className="ml pl id-page" crumbs={crumbs()} title={tx('অনুমতি')}>
        <Box icon={<SafetyCertificateFilled />} title={tx('কোন রোলের অনুমতি দেখবেন?')}>
          {roles.isLoading ? (
            <Spin />
          ) : (
            <div className="pm-roles">
              {(roles.data ?? []).map((r) => (
                <button key={r.id} type="button" onClick={() => navigate(`/admin/roles/${r.id}/permissions`)}>
                  <KeyOutlined />
                  <strong>{r.label ?? r.name}</strong>
                  <span>{tx('{{p0}} জন ইউজার', { p0: digits(r.users_count) })}</span>
                </button>
              ))}
            </div>
          )}
        </Box>
      </PageFrame>
    )
  if (isLoading || !data) return <Spin />
  // Remount the editor whenever the saved permissions change so local edits reset to them.
  return <Matrix key={data.granted.join(',')} id={id} data={data} roles={roles.data ?? []} />
}

function Matrix({ id, data, roles }: { id: string; data: MatrixData; roles: Role[] }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [granted, setGranted] = useState<Set<string>>(() => new Set(data.granted))
  const [saving, setSaving] = useState(false)

  const readOnly = data.locked || !can('role.admin')
  const modules = useMemo(() => Object.entries(data.modules), [data])
  const actions = useMemo(() => Object.entries(data.actions), [data])
  const totalCells = modules.length * actions.length
  const saved = new Set(data.granted)
  const changed = [...granted].filter((n) => !saved.has(n)).length + data.granted.filter((n) => !granted.has(n)).length
  const fullModules = modules.filter(([m]) => actions.every(([a]) => granted.has(`${m}.${a}`))).length

  const toggle = (names: string[], on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev)
      names.forEach((n) => (on ? next.add(n) : next.delete(n)))
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/roles/${id}/permissions`, { permissions: [...granted] })
      message.success(tx('অনুমতি সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['roles', id, 'permissions'] })
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const colState = (a: string) => {
    const names = modules.map(([m]) => `${m}.${a}`)
    const count = names.filter((n) => granted.has(n)).length
    return { names, all: count === names.length, some: count > 0 && count < names.length }
  }

  const cards = [
    { key: 'granted', label: tx('দেওয়া অনুমতি · মোট {{p0}}টি', { p0: digits(totalCells) }), value: data.locked ? totalCells : granted.size, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'full', label: tx('সম্পূর্ণ অনুমতির মডিউল · মোট {{p0}}টি', { p0: digits(modules.length) }), value: data.locked ? modules.length : fullModules, icon: '', glyph: <AppstoreFilled />, color: '#1769e0', tint: '#e4edfd' },
    { key: 'users', label: tx('এই রোলের ইউজার'), value: roles.find((r) => r.id === Number(id))?.users_count, icon: '', glyph: <TeamOutlined />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => navigate(`/admin/users`) },
    { key: 'changed', label: tx('সংরক্ষণ বাকি পরিবর্তন'), value: changed, icon: '', glyph: <EditFilled />, color: changed ? '#f08c00' : '#6b7280', tint: changed ? '#fdefd6' : '#eef0f3' },
  ]

  return (
    <PageFrame
      className="ml pl id-page"
      crumbs={crumbs(data.role.label ?? data.role.name)}
      title={tx('অনুমতি — {{p0}}', { p0: data.role.label ?? data.role.name })}
      actions={
        <span className="id-actions">
          <Select className="pm-switch" value={Number(id)} showSearch={{ optionFilterProp: 'label' }} options={roles.map((r) => ({ value: r.id, label: r.label ?? r.name }))} onChange={(v) => navigate(`/admin/roles/${v}/permissions`)} />
          {!readOnly && (
            <>
              <Button icon={<UndoOutlined />} className="fm-history-btn" disabled={!changed} onClick={() => setGranted(new Set(data.granted))}>
                {tx('আগের অবস্থায় ফেরান')}
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!changed} onClick={save}>
                {tx('সংরক্ষণ')}
              </Button>
            </>
          )}
        </span>
      }
    >
      <StatRow cards={cards} className="li-cards" />
      {data.locked && <Alert className="id-alert" type="info" showIcon title={tx('সুপার অ্যাডমিন সবসময় সব অনুমতি পান; এটি পরিবর্তন করা যায় না।')} />}
      <Box icon={<KeyOutlined />} title={tx('মডিউল ও কাজ')}>
        <Table
          rowKey={([m]) => m}
          size="small"
          className="id-payments pm-grid"
          pagination={false}
          dataSource={modules}
          scroll={{ x: 'max-content' }}
          sticky
          columns={[
            {
              title: tx('মডিউল'),
              fixed: 'left',
              width: 210,
              render: (_, [m, label]) => {
                const names = actions.map(([a]) => `${m}.${a}`)
                const count = names.filter((n) => granted.has(n)).length
                return (
                  <Checkbox disabled={readOnly} checked={data.locked || count === names.length} indeterminate={!data.locked && count > 0 && count < names.length} onChange={(e) => toggle(names, e.target.checked)}>
                    <strong>{label}</strong>
                  </Checkbox>
                )
              },
            },
            ...actions.map(([a, label]) => {
              const st = colState(a)
              return {
                title: (
                  <Checkbox disabled={readOnly} checked={data.locked || st.all} indeterminate={!data.locked && st.some} onChange={(e) => toggle(st.names, e.target.checked)}>
                    {label}
                  </Checkbox>
                ),
                align: 'center' as const,
                render: (_: unknown, [m]: [string, string]) => {
                  const name = `${m}.${a}`
                  return <Checkbox aria-label={name} disabled={readOnly} checked={data.locked || granted.has(name)} onChange={(e) => toggle([name], e.target.checked)} />
                },
              }
            }),
          ]}
        />
      </Box>
    </PageFrame>
  )
}
