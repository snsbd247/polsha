import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Switch, Table, Tag } from 'antd'
import { ScanOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { toOptions } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Row = {
  id: number
  entity_type: string
  entity_id: number | null
  code: string
  label: string | null
  found: boolean
  source: string
  ip: string | null
  created_at: string
  user: { id: number; name_bn: string; name_en: string | null; username: string } | null
}
type Resp = Paginated<Row> & { types: Record<string, string>; can_all: boolean }
type Params = { page: number; per_page: number; all?: number; entity_type?: string; source?: string; found?: number; from?: string; to?: string; search?: string }

const SOURCE_LABEL: Record<string, string> = { camera: tx('ক্যামেরা'), manual: tx('হাতে লেখা'), link: tx('লিংক') }
const PATH: Record<string, (id: number, code: string) => string> = {
  farmer: (id) => `/q/farmer/${id}`,
  member: (_, c) => `/q/member/${c}`,
  land: (_, c) => `/q/land/${c}`,
  asset: (id) => `/assets/${id}`,
}

export default function QrHistoryPage() {
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const { data, isFetching } = useQuery({
    queryKey: ['qr-history', params],
    queryFn: async () => (await api.get<Resp>('/qr/history', { params })).data,
    placeholderData: keepPreviousData,
  })
  const target = (r: Row) => {
    if (!r.found || !r.entity_id) return r.label
    if (r.entity_type === 'asset') return <Link to={PATH.asset(r.entity_id, r.code)}>{r.label}</Link>
    if (r.entity_type === 'receipt' || r.entity_type === 'combined') return <Link to={`/verify/${r.entity_type}/${r.code}`}>{r.label}</Link>
    return <Link to={`/q/${r.entity_type}/${encodeURIComponent(r.code)}`}>{r.label}</Link>
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('QR স্ক্যানের ইতিহাস')}</h2>
        <Link to="/qr/scan">
          <Button type="primary" icon={<ScanOutlined />}>
            {tx('QR স্ক্যানার')}
          </Button>
        </Link>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('কোড বা নাম')} allowClear style={{ width: 220 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('ধরন')} allowClear style={{ width: 160 }} options={toOptions(data?.types)} onChange={(entity_type) => set({ entity_type })} />
        <Select placeholder={tx('উৎস')} allowClear style={{ width: 130 }} options={toOptions(SOURCE_LABEL)} onChange={(source) => set({ source })} />
        <Select
          placeholder={tx('ফলাফল')}
          allowClear
          style={{ width: 140 }}
          options={[
            { value: 1, label: tx('পাওয়া গেছে') },
            { value: 0, label: tx('পাওয়া যায়নি') },
          ]}
          onChange={(found) => set({ found })}
        />
        <DatePicker.RangePicker format="DD/MM/YYYY" onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })} />
        {data?.can_all && (
          <span>
            <Switch size="small" checked={!!params.all} onChange={(v) => set({ all: v ? 1 : undefined })} /> {tx('সবার স্ক্যান')}
          </span>
        )}
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data?.total, onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })) }}
        columns={[
          { title: tx('সময়'), dataIndex: 'created_at', width: 170, render: fmtDateTime },
          { title: tx('ধরন'), dataIndex: 'entity_type', width: 120, render: (v: string) => data?.types[v] ?? v },
          { title: tx('কোড'), dataIndex: 'code', render: (v: string) => digits(v) },
          { title: tx('তথ্য'), render: (_, r) => target(r) },
          { title: tx('ফলাফল'), dataIndex: 'found', width: 120, render: (f: boolean) => (f ? <Tag color="green">{tx('পাওয়া গেছে')}</Tag> : <Tag color="red">{tx('পাওয়া যায়নি')}</Tag>) },
          { title: tx('উৎস'), dataIndex: 'source', width: 100, render: (v: string) => SOURCE_LABEL[v] ?? v },
          ...(params.all ? [{ title: tx('ইউজার'), render: (_: unknown, r: Row) => nameOf(r.user) }] : []),
        ]}
      />
    </>
  )
}
