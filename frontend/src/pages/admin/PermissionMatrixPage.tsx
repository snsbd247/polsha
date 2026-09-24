import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Select, Space, Spin, Table } from 'antd'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { useRoles } from '../../lib/queries'
import type { Role } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type MatrixData = {
  role: Role
  modules: Record<string, string>
  actions: Record<string, string>
  granted: string[]
  locked: boolean
}

export default function PermissionMatrixPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const roles = useRoles(!id)
  const { data, isLoading } = useQuery({
    queryKey: ['roles', id, 'permissions'],
    queryFn: async () => (await api.get<MatrixData>(`/roles/${id}/permissions`)).data,
    enabled: !!id,
  })

  // Opened from the menu without a role: pick one first.
  if (!id)
    return (
      <>
        <div className="page-header">
          <h2>{tx('অনুমতি')}</h2>
        </div>
        <Card>
          <Select
            placeholder={tx('রোল বাছাই করুন')}
            style={{ width: 320 }}
            loading={roles.isLoading}
            options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.label ?? r.name }))}
            onChange={(v) => navigate(`/admin/roles/${v}/permissions`)}
          />
        </Card>
      </>
    )
  if (isLoading || !data) return <Spin />
  // Remount the editor whenever the saved permissions change so local edits reset to them.
  return <Matrix key={data.granted.join(',')} id={id!} data={data} />
}

function Matrix({ id, data }: { id: string; data: MatrixData }) {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [granted, setGranted] = useState<Set<string>>(() => new Set(data.granted))
  const [saving, setSaving] = useState(false)

  const readOnly = data.locked || !can('role.admin')
  const modules = useMemo(() => Object.entries(data.modules), [data])
  const actions = useMemo(() => Object.entries(data.actions), [data])

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

  return (
    <>
      <div className="page-header">
        <h2>{tx('অনুমতি —')}{' '}{data.role.label}</h2>
        {!readOnly && (
          <Space>
            <Button onClick={() => setGranted(new Set(data.granted))}>{tx('আগের অবস্থায় ফেরান')}</Button>
            <Button type="primary" loading={saving} onClick={save}>
              {tx('সংরক্ষণ')}
            </Button>
          </Space>
        )}
      </div>
      {data.locked && <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('সুপার অ্যাডমিন সবসময় সব অনুমতি পান; এটি পরিবর্তন করা যায় না।')} />}
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey={([m]) => m}
          size="small"
          pagination={false}
          dataSource={modules}
          scroll={{ x: 900 }}
          sticky
          columns={[
            {
              title: tx('মডিউল'),
              fixed: 'left',
              width: 200,
              render: (_, [m, label]) => {
                const names = actions.map(([a]) => `${m}.${a}`)
                const count = names.filter((n) => granted.has(n)).length
                return (
                  <Checkbox
                    disabled={readOnly}
                    checked={count === names.length}
                    indeterminate={count > 0 && count < names.length}
                    onChange={(e) => toggle(names, e.target.checked)}
                  >
                    {label}
                  </Checkbox>
                )
              },
            },
            ...actions.map(([a, label]) => {
              const st = colState(a)
              return {
                title: (
                  <Checkbox disabled={readOnly} checked={st.all} indeterminate={st.some} onChange={(e) => toggle(st.names, e.target.checked)}>
                    {label}
                  </Checkbox>
                ),
                align: 'center' as const,
                render: (_: unknown, [m]: [string, string]) => {
                  const name = `${m}.${a}`
                  return <Checkbox aria-label={name} disabled={readOnly} checked={granted.has(name)} onChange={(e) => toggle([name], e.target.checked)} />
                },
              }
            }),
          ]}
        />
      </Card>
    </>
  )
}
