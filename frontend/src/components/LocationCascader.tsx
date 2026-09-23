import { useQuery } from '@tanstack/react-query'
import { Select, Space } from 'antd'
import { api } from '../lib/api'
import type { LocationItem } from '../lib/types'

const LEVELS = [
  { key: 'divisions', label: 'বিভাগ' },
  { key: 'districts', label: 'জেলা' },
  { key: 'upazilas', label: 'উপজেলা' },
  { key: 'unions', label: 'ইউনিয়ন' },
  { key: 'villages', label: 'গ্রাম' },
] as const

export type LocationPath = (number | undefined)[]

function LevelSelect({ index, parentId, value, onChange }: { index: number; parentId?: number; value?: number; onChange: (v?: number) => void }) {
  const level = LEVELS[index]
  const enabled = index === 0 || !!parentId
  const { data, isLoading } = useQuery({
    queryKey: ['locations', level.key, parentId ?? null, 'active'],
    queryFn: async () => (await api.get<LocationItem[]>(`/locations/${level.key}`, { params: { parent_id: parentId, active_only: 1 } })).data,
    enabled,
  })
  return (
    <Select
      placeholder={level.label}
      style={{ minWidth: 150 }}
      allowClear
      showSearch={{ optionFilterProp: 'label' }}
      disabled={!enabled}
      loading={isLoading}
      value={value}
      onChange={onChange}
      options={data?.map((d) => ({ value: d.id, label: d.name_bn }))}
    />
  )
}

/** Division → … → `depth` cascading selects. Clearing a level clears everything below it. */
export default function LocationCascader({ value = [], onChange, depth = 5 }: { value?: LocationPath; onChange: (v: LocationPath) => void; depth?: number }) {
  return (
    <Space wrap>
      {Array.from({ length: depth }, (_, i) => (
        <LevelSelect
          key={i}
          index={i}
          parentId={i === 0 ? undefined : value[i - 1]}
          value={value[i]}
          onChange={(v) => onChange([...value.slice(0, i), v, ...Array(depth - i - 1).fill(undefined)].slice(0, depth))}
        />
      ))}
    </Space>
  )
}
