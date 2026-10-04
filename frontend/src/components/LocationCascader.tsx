import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Divider, Input, Select, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { api, errorMessage } from '../lib/api'
import type { LocationItem } from '../lib/types'
import { t as tx } from '../lib/i18n'

export const LEVELS = [
  { key: 'divisions', label: tx('বিভাগ') },
  { key: 'districts', label: tx('জেলা') },
  { key: 'upazilas', label: tx('উপজেলা') },
  { key: 'unions', label: tx('ইউনিয়ন') },
  { key: 'villages', label: tx('গ্রাম') },
] as const

export type LocationPath = (number | undefined)[]

/** One level of the cascade (0 = division … 4 = village); pages that lay the levels out themselves use it directly. */
export function LevelSelect({ index, parentId, value, onChange, placeholder }: { index: number; parentId?: number; value?: number; onChange: (v?: number) => void; placeholder?: string }) {
  const level = LEVELS[index]
  const enabled = index === 0 || !!parentId
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const queryKey = ['locations', level.key, parentId ?? null, 'active']
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<LocationItem[]>(`/locations/${level.key}`, { params: { parent_id: parentId, active_only: 1 } })).data,
    enabled,
  })
  // villages are not in any countrywide list: a missing one is added right here, under the chosen union
  const canAdd = level.key === 'villages' && !!parentId && can('location.create')
  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      const r = await api.post<LocationItem>('/locations/villages', { union_id: parentId, name_bn: name })
      await queryClient.invalidateQueries({ queryKey })
      setNewName('')
      onChange(r.data.id)
      message.success(tx('গ্রাম যোগ হয়েছে।'))
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }
  return (
    <Select
      placeholder={placeholder ?? level.label}
      style={{ minWidth: 150 }}
      allowClear
      showSearch={{ optionFilterProp: 'label' }}
      disabled={!enabled}
      loading={isLoading}
      // until the names arrive the raw id would show, so hold the value back
      value={data ? value : undefined}
      onChange={onChange}
      options={data?.map((d) => ({ value: d.id, label: d.name_bn }))}
      notFoundContent={canAdd ? tx('এই ইউনিয়নে কোনো গ্রাম নেই — নিচে যোগ করুন') : undefined}
      popupRender={
        canAdd
          ? (menu) => (
              <>
                {menu}
                <Divider style={{ margin: '6px 0' }} />
                <Space.Compact style={{ width: '100%', padding: '0 6px 4px' }}>
                  <Input value={newName} placeholder={tx('নতুন গ্রামের নাম')} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onPressEnter={add} />
                  <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={add}>
                    {tx('যোগ করুন')}
                  </Button>
                </Space.Compact>
              </>
            )
          : undefined
      }
    />
  )
}

/** The names of the chosen levels (union, upazila, …), nearest first — read from the same lists the selects load. */
export function useLevelNames(path: LocationPath, upto: number): string[] {
  const lists = useQueries({
    queries: LEVELS.slice(0, upto).map((level, i) => ({
      queryKey: ['locations', level.key, i === 0 ? null : (path[i - 1] ?? null), 'active'],
      queryFn: async () => (await api.get<LocationItem[]>(`/locations/${level.key}`, { params: { parent_id: i === 0 ? undefined : path[i - 1], active_only: 1 } })).data,
      enabled: i === 0 || !!path[i - 1],
    })),
  })
  return lists
    .map((q, i) => q.data?.find((d) => d.id === path[i])?.name_bn)
    .filter((n): n is string => !!n)
    .reverse()
}

/** Division → … → `depth` cascading selects. Clearing a level clears everything below it. */
export default function LocationCascader({ value = [], onChange, depth = 5 }: { value?: LocationPath; onChange: (v: LocationPath) => void; depth?: number }) {
  return (
    <Space wrap>
      {Array.from({ length: depth }, (_, i) => (
        <LevelSelect key={i} index={i} parentId={i === 0 ? undefined : value[i - 1]} value={value[i]} onChange={(v) => onChange([...value.slice(0, i), v, ...Array(depth - i - 1).fill(undefined)].slice(0, depth))} />
      ))}
    </Space>
  )
}
