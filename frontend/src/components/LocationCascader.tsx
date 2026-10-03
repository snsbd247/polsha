import { useQueries, useQuery } from '@tanstack/react-query'
import { Select, Space } from 'antd'
import { api } from '../lib/api'
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
  const { data, isLoading } = useQuery({
    queryKey: ['locations', level.key, parentId ?? null, 'active'],
    queryFn: async () => (await api.get<LocationItem[]>(`/locations/${level.key}`, { params: { parent_id: parentId, active_only: 1 } })).data,
    enabled,
  })
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
