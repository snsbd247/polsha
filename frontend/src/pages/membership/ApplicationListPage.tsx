import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { APPLICATION_STATUS } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'

type Row = {
  id: number
  application_no: string
  applied_on: string
  admission_fee: string
  status: string
  farmer: { id: number; farmer_code: string; name_bn: string; father_name: string; village: { name_bn: string } | null }
  member: { member_no: number } | null
}

type Params = { page: number; per_page: number; search?: string; status?: string; mouza_id?: number; from?: string; to?: string }

export default function ApplicationListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['membership-applications', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/membership-applications', { params })).data,
    placeholderData: keepPreviousData,
  })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  return (
    <>
      <div className="page-header">
        <h2>সদস্যপদ আবেদন</h2>
        <Can perm="membership.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/membership/applications/new')}>
            নতুন আবেদন
          </Button>
        </Can>
      </div>
      <div className="toolbar">
        <Input.Search placeholder="আবেদন নং, নাম বা Farmer ID" allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <Select placeholder="অবস্থা" allowClear style={{ width: 200 }} options={Object.entries(APPLICATION_STATUS).map(([value, s]) => ({ value, label: s.label }))} onChange={(status) => set({ status })} />
        <Select
          placeholder="মৌজা"
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: 180 }}
          options={mouzas.data?.map((m) => ({ value: m.id, label: m.name_bn }))}
          onChange={(mouza_id) => set({ mouza_id })}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r: [Dayjs | null, Dayjs | null] | null) => set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })}
        />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 800 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => `মোট ${digits(t)}টি`,
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'আবেদন নং', dataIndex: 'application_no', render: (v, r) => <Link to={`/membership/applications/${r.id}`}>{v}</Link> },
          { title: 'কৃষক', render: (_, r) => <Link to={`/farmers/${r.farmer.id}`}>{r.farmer.name_bn}</Link> },
          { title: 'পিতা', render: (_, r) => r.farmer.father_name },
          { title: 'গ্রাম', render: (_, r) => r.farmer.village?.name_bn },
          { title: 'তারিখ', dataIndex: 'applied_on', render: fmtDate },
          { title: 'ভর্তি ফি', dataIndex: 'admission_fee', render: (v) => `৳ ${digits(Number(v))}` },
          {
            title: 'অবস্থা',
            dataIndex: 'status',
            render: (s, r) => (
              <>
                <Tag color={APPLICATION_STATUS[s]?.color}>{APPLICATION_STATUS[s]?.label ?? s}</Tag>
                {r.member && <Tag color="green">সদস্য নং {digits(r.member.member_no)}</Tag>}
              </>
            ),
          },
        ]}
      />
    </>
  )
}
