import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { CULTIVATION_COLOR, fmtArea, LAND_STATUS_COLOR, useLandMeta, type LandRow } from '../../lib/land'
import { downloadExport } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type Params = { page: number; per_page: number; search?: string; mouza_id?: number; land_type_id?: number; status?: string; cultivation?: string; survey?: string }

export default function LandListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { data: meta } = useLandMeta()
  const [sp] = useSearchParams()
  const urlSearch = sp.get('search') || undefined
  const [params, setParams] = useState<Params>(() => ({ page: 1, per_page: 25, search: urlSearch, mouza_id: sp.get('mouza_id') ? Number(sp.get('mouza_id')) : undefined }))
  // the top-bar search opens this list with ?search=
  useEffect(() => setParams((p) => ({ ...p, search: urlSearch, page: 1 })), [urlSearch])
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['lands', params],
    queryFn: async () => (await api.get<Paginated<LandRow> & { total_area: number }>('/lands', { params })).data,
    placeholderData: keepPreviousData,
  })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  return (
    <>
      <div className="page-header">
        <h2>{tx('জমি')}</h2>
        <Space wrap>
          <Can perm="land.export">
            <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/lands/export', { ...params, page: undefined }, 'lands.csv').catch((e) => message.error(errorMessage(e)))}>
              Excel
            </Button>
          </Can>
          <Can perm="land.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/new')}>
              {tx('নতুন জমি')}
            </Button>
          </Can>
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('Land ID, দাগ, খতিয়ান, মালিক বা চাষি')} allowClear style={{ width: 300 }} key={urlSearch} defaultValue={urlSearch} onSearch={(search) => set({ search })} />
        <Select
          placeholder={tx('মৌজা')}
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: 180 }}
          value={params.mouza_id}
          options={mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))}
          onChange={(mouza_id) => set({ mouza_id })}
        />
        <Select placeholder={tx('জমির ধরন')} allowClear style={{ width: 170 }} options={meta?.land_types.map((t) => ({ value: t.id, label: t.name_bn }))} onChange={(land_type_id) => set({ land_type_id })} />
        <Select
          placeholder={tx('চাষ')}
          allowClear
          style={{ width: 150 }}
          options={[...Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label })), { value: 'none', label: tx('চাষি নেই') }]}
          onChange={(cultivation) => set({ cultivation })}
        />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 130 }} options={Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))} onChange={(status) => set({ status })} />
      </div>
      <Table<LandRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি জমি · {{p1}}', { p0: digits(t), p1: fmtArea(data?.total_area, meta) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'Land ID', dataIndex: 'land_code', width: 110, render: (v, l) => <Link to={`/lands/${l.id}`}>{v}</Link> },
          { title: tx('মৌজা'), dataIndex: 'mouza' },
          { title: tx('খতিয়ান'), render: (_, l) => `${digits(l.khatian_no)} (${meta?.surveys[l.survey] ?? l.survey})` },
          { title: tx('দাগ'), dataIndex: 'dag_no', render: digits },
          { title: tx('পরিমাণ'), dataIndex: 'area_decimal', render: (v) => fmtArea(v, meta) },
          {
            title: tx('মালিক'),
            render: (_, l) =>
              l.owners.map((o) => (
                <div key={o.id}>
                  <Link to={`/farmers/${o.farmer_id}`}>{o.name_bn}</Link>
                  {l.owners.length > 1 && <Typography.Text type="secondary"> ({digits(o.share_percent)}%)</Typography.Text>}
                </div>
              )),
          },
          {
            title: tx('চাষি'),
            render: (_, l) =>
              l.cultivation ? (
                <>
                  <Link to={`/farmers/${l.cultivation.farmer_id}`}>{l.cultivation.name_bn}</Link>{' '}
                  <Tag color={CULTIVATION_COLOR[l.cultivation.type]}>{meta?.cultivation_types[l.cultivation.type]}</Tag>
                </>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          { title: tx('ধরন'), dataIndex: 'land_type' },
          { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag color={LAND_STATUS_COLOR[s]}>{meta?.statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}
