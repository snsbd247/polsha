import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Card, DatePicker, Input, Select } from 'antd'
import type { Dayjs } from 'dayjs'
import AuditLogTable from '../../components/AuditLogTable'
import { api, type Paginated } from '../../lib/api'
import { ACTION_LABELS, toEnDigits } from '../../lib/format'
import type { AuditLog, UserRow } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type Params = { page: number; per_page: number; module?: string; action?: string; user_id?: number; auditable_id?: string; from?: string; to?: string }

export default function AuditLogPage() {
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const meta = useQuery({
    queryKey: ['audit-meta'],
    queryFn: async () => (await api.get<{ modules: Record<string, string>; actions: string[] }>('/audit-logs/meta')).data,
  })
  const users = useQuery({
    queryKey: ['users', 'all-for-filter'],
    queryFn: async () => (await api.get<Paginated<UserRow>>('/users', { params: { per_page: 100 } })).data.data,
    retry: false,
  })
  const logs = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => (await api.get<Paginated<AuditLog>>('/audit-logs', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('অডিট লগ')}</h2>
      </div>
      <div className="toolbar">
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r: [Dayjs | null, Dayjs | null] | null) =>
            set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })
          }
        />
        <Select
          placeholder={tx('ইউজার')}
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: 180 }}
          options={users.data?.map((u) => ({ value: u.id, label: u.name_bn }))}
          onChange={(user_id) => set({ user_id })}
        />
        <Select
          placeholder={tx('মডিউল')}
          allowClear
          style={{ width: 160 }}
          options={Object.entries(meta.data?.modules ?? {}).map(([value, label]) => ({ value, label }))}
          onChange={(module) => set({ module })}
        />
        <Select
          placeholder={tx('কাজ')}
          allowClear
          style={{ width: 160 }}
          options={meta.data?.actions.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))}
          onChange={(action) => set({ action })}
        />
        <Input.Search placeholder={tx('রেকর্ড ID')} allowClear style={{ width: 140 }} onSearch={(v) => set({ auditable_id: v ? toEnDigits(v) : undefined })} />
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <AuditLogTable
          data={logs.data}
          loading={logs.isFetching}
          page={params.page}
          modules={meta.data?.modules}
          onPage={(page, per_page) => setParams((p) => ({ ...p, page, per_page }))}
        />
      </Card>
    </>
  )
}
