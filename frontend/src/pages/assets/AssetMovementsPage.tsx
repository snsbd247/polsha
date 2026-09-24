import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Pagination } from 'antd'
import { UnorderedListOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { useAssetMeta } from '../../lib/phase8'
import { t as tx } from '../../lib/i18n'
import { MovementTable, type Movement } from './AssetDetailPage'
import type { AssetRow } from './AssetListPage'

type Preset = 'transfer' | 'install' | 'repair'
const PRESET: Record<Preset, { title: string; types: string; hint: string }> = {
  transfer: { title: tx('সম্পদ স্থানান্তর'), types: 'transfer', hint: tx('নতুন স্থানান্তর করতে সম্পদের পাতায় "স্থানান্তর" চাপুন।') },
  install: { title: tx('সম্পদ স্থাপন'), types: 'install,uninstall', hint: tx('স্টকের সম্পদ স্থাপন করতে সম্পদের পাতায় "স্থাপন" চাপুন।') },
  repair: { title: tx('সম্পদ মেরামত'), types: 'repair,repaired', hint: tx('মেরামতে পাঠাতে সম্পদের পাতায় "মেরামতে পাঠান" চাপুন।') },
}
type Params = { page: number; per_page: number; from?: string; to?: string; search?: string }

/** Movement log across all assets, filtered for the Transfer / Installation / Repair menu items. */
export default function AssetMovementsPage({ preset }: { preset: Preset }) {
  const { can } = useAuth()
  const meta = useAssetMeta()
  const p = PRESET[preset]
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((x) => ({ ...x, ...patch, page: 1 }))
  const { data, isFetching } = useQuery({
    queryKey: ['asset-movements', p.types, params],
    queryFn: async () => (await api.get<Paginated<Movement & { asset: AssetRow }>>('/assets/movements', { params: { ...params, types: p.types } })).data,
    placeholderData: keepPreviousData,
  })
  const statusLink = preset === 'install' ? '/assets/stock' : '/assets'

  return (
    <>
      <div className="page-header">
        <h2>{p.title}</h2>
        <Link to={statusLink}>
          <Button icon={<UnorderedListOutlined />}>{preset === 'install' ? tx('স্টক') : tx('সম্পদ রেজিস্টার')}</Button>
        </Link>
      </div>
      <p style={{ color: '#888' }}>{p.hint}</p>
      <div className="toolbar">
        <Input.Search placeholder={tx('সম্পদ, অবস্থান বা দায়িত্বপ্রাপ্ত')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <DatePicker.RangePicker format="DD/MM/YYYY" onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })} />
      </div>
      <div style={{ opacity: isFetching ? 0.6 : 1 }}>
        <MovementTable rows={data?.data ?? []} types={meta.data?.movement_types} conditions={meta.data?.conditions} canJournal={can('accounting.view')} withAsset />
      </div>
      <Pagination
        style={{ marginTop: 16, textAlign: 'right' }}
        current={params.page}
        pageSize={params.per_page}
        total={data?.total ?? 0}
        onChange={(page, per_page) => setParams((x) => ({ ...x, page, per_page }))}
      />
    </>
  )
}
