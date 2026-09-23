import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Dropdown, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, MoreOutlined, PlusOutlined, UsergroupDeleteOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import LocationCascader, { type LocationPath } from '../../components/LocationCascader'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { downloadExport, MEMBER_STATUS, type FarmerRow } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Params = { page: number; per_page: number; search?: string; type?: string; is_active?: string; union_id?: number; village_id?: number; mouza_id?: number }

export default function FarmerListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const [path, setPath] = useState<LocationPath>([])
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['farmers', params],
    queryFn: async () => (await api.get<Paginated<FarmerRow>>('/farmers', { params })).data,
    placeholderData: keepPreviousData,
  })

  const exportCsv = async () => {
    try {
      await downloadExport('/farmers/export', { ...params, page: undefined }, 'farmers.csv')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('কৃষক')}</h2>
        <Space wrap>
          <Can perm="farmer.view">
            <Button icon={<UsergroupDeleteOutlined />} onClick={() => navigate('/farmers/duplicates')}>
              {tx('ডুপ্লিকেট পর্যালোচনা')}
            </Button>
          </Can>
          <Can perm="farmer.export">
            <Button icon={<DownloadOutlined />} onClick={exportCsv}>
              Excel
            </Button>
          </Can>
          <Can perm="farmer.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/farmers/new')}>
              {tx('নতুন কৃষক')}
            </Button>
          </Can>
        </Space>
      </div>

      <div className="toolbar">
        <Input.Search placeholder={tx('নাম, পিতা, Farmer ID, NID, মোবাইল বা সদস্য নং')} allowClear style={{ width: 320 }} onSearch={(search) => set({ search })} />
        <Select
          placeholder={tx('ধরন')}
          allowClear
          style={{ width: 150 }}
          options={[
            { value: 'member', label: tx('সদস্য') },
            { value: 'non_member', label: tx('নন-মেম্বার') },
          ]}
          onChange={(type) => set({ type })}
        />
        <Select
          placeholder={tx('অবস্থা')}
          allowClear
          style={{ width: 130 }}
          options={[
            { value: '1', label: tx('সক্রিয়') },
            { value: '0', label: tx('নিষ্ক্রিয়') },
          ]}
          onChange={(is_active) => set({ is_active })}
        />
      </div>
      <div className="toolbar">
        <LocationCascader
          value={path}
          onChange={(v) => {
            setPath(v)
            set({ union_id: v[4] ? undefined : v[3], village_id: v[4] })
          }}
        />
      </div>

      <Table<FarmerRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}} জন', { p0: digits(t) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'Farmer ID', dataIndex: 'farmer_code', width: 110 },
          { title: tx('নাম'), dataIndex: 'name_bn', render: (_, f) => <Link to={`/farmers/${f.id}`}>{nameOf(f)}</Link> },
          { title: tx('পিতা'), dataIndex: 'father_name' },
          { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
          { title: tx('গ্রাম'), dataIndex: 'village' },
          { title: tx('মৌজা'), dataIndex: 'mouza' },
          {
            title: tx('ধরন'),
            render: (_, f) =>
              f.member ? (
                <Tag color={MEMBER_STATUS[f.member.status].color}>{tx('সদস্য নং')}{' '}{digits(f.member.member_no)}</Tag>
              ) : (
                <Tag>{tx('নন-মেম্বার')}</Tag>
              ),
          },
          { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">{tx('সক্রিয়')}</Tag> : <Tag color="red">{tx('নিষ্ক্রিয়')}</Tag>) },
          {
            title: '',
            width: 48,
            render: (_, f) => {
              const items = [
                can('farmer.edit') && { key: 'edit', label: tx('সম্পাদনা'), onClick: () => navigate(`/farmers/${f.id}/edit`) },
                can('membership.create') && !f.member && f.is_active && {
                  key: 'apply',
                  label: tx('সদস্য করুন'),
                  onClick: () => navigate(`/membership/applications/new?farmer=${f.id}`),
                },
              ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
              return items.length ? (
                <Dropdown menu={{ items }} trigger={['click']}>
                  <Button type="text" icon={<MoreOutlined />} aria-label={tx('আরও')} />
                </Dropdown>
              ) : null
            },
          },
        ]}
      />
    </>
  )
}
