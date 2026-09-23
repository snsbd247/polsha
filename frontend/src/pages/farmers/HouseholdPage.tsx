import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { MEMBER_STATUS, toOptions, useFarmerMeta, type MemberRef } from '../../lib/phase2'

type Row = { id: number; code: string; head: { id: number; name_bn: string; farmer_code: string } | null; village: { name_bn: string } | null; farmers_count: number; members_count: number }
type Detail = Row & {
  farmers: { id: number; farmer_code: string; name_bn: string; father_name: string; household_relation: string | null; is_active: boolean; member: MemberRef | null }[]
}

function HouseholdDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm()

  const { data } = useQuery({
    queryKey: ['households', id],
    queryFn: async () => (await api.get<Detail>(`/households/${id}`)).data,
    enabled: !!id,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['households'] })
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <Drawer open={!!id} onClose={onClose} title={data ? `খানা ${data.code}` : ''} size={720}>
      {data && (
        <>
          <p>
            খানাপ্রধান: <strong>{data.head?.name_bn ?? '—'}</strong> · গ্রাম: {data.village?.name_bn ?? '—'}
          </p>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={data.farmers}
            scroll={{ x: 560 }}
            columns={[
              { title: 'নাম', dataIndex: 'name_bn', render: (v, f) => <Link to={`/farmers/${f.id}`}>{v}</Link> },
              { title: 'সম্পর্ক', dataIndex: 'household_relation', render: (r) => (r ? meta?.relations[r] ?? r : '—') },
              {
                title: 'সমিতির সদস্য',
                render: (_, f) => (f.member ? <Tag color={MEMBER_STATUS[f.member.status].color}>নং {digits(f.member.member_no)}</Tag> : '—'),
              },
              {
                title: '',
                render: (_, f) =>
                  can('farmer.edit') &&
                  f.id !== data.head?.id && (
                    <Space>
                      <Button size="small" onClick={() => act(() => api.post(`/households/${data.id}/head`, { head_farmer_id: f.id }))}>
                        খানাপ্রধান করুন
                      </Button>
                      <Button size="small" danger onClick={() => act(() => api.delete(`/households/${data.id}/members/${f.id}`))}>
                        বাদ দিন
                      </Button>
                    </Space>
                  ),
              },
            ]}
          />
          <Can perm="farmer.edit">
            <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
              সদস্য যোগ করুন
            </Button>
          </Can>
          <Modal
            open={adding}
            title="খানায় সদস্য যোগ"
            forceRender
            onCancel={() => setAdding(false)}
            okText="যোগ করুন"
            cancelText="বাতিল"
            onOk={async () => {
              const v = await form.validateFields()
              await act(() => api.post(`/households/${data.id}/members`, { farmer_id: v.farmer_id, relation: v.relation }))
              form.resetFields()
              setAdding(false)
            }}
          >
            <Form form={form} layout="vertical">
              <Form.Item name="farmer_id" label="কৃষক" rules={[{ required: true, message: 'কৃষক বাছাই করুন' }]}>
                <FarmerPicker />
              </Form.Item>
              <Form.Item name="relation" label="খানাপ্রধানের সাথে সম্পর্ক" rules={[{ required: true, message: 'সম্পর্ক দিন' }]}>
                <Select options={toOptions(meta?.relations).filter((o) => o.value !== 'self')} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  )
}

export default function HouseholdPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const [params, setParams] = useState({ page: 1, per_page: 25, search: '' })
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()
  const openId = sp.get('open') ? Number(sp.get('open')) : null

  const { data, isFetching } = useQuery({
    queryKey: ['households', 'list', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/households', { params })).data,
    placeholderData: keepPreviousData,
  })

  const create = async () => {
    const v = await form.validateFields()
    try {
      const r = await api.post('/households', v)
      message.success('খানা তৈরি হয়েছে।')
      setCreating(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['households'] })
      setSp({ open: String(r.data.id) })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>খানা (Household)</h2>
        <Can perm="farmer.edit">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            নতুন খানা
          </Button>
        </Can>
      </div>
      <div className="toolbar">
        <Input.Search placeholder="খানার কোড বা খানাপ্রধানের নাম" allowClear style={{ width: 300 }} onSearch={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 700 }}
        onRow={(r) => ({ onClick: () => setSp({ open: String(r.id) }), style: { cursor: 'pointer' } })}
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
          { title: 'খানা', dataIndex: 'code' },
          { title: 'খানাপ্রধান', render: (_, r) => r.head?.name_bn ?? '—' },
          { title: 'গ্রাম', render: (_, r) => r.village?.name_bn ?? '—' },
          { title: 'সদস্য সংখ্যা', dataIndex: 'farmers_count', render: digits },
          { title: 'সমিতির সক্রিয় সদস্য', dataIndex: 'members_count', render: digits },
        ]}
      />
      <HouseholdDrawer id={openId} onClose={() => setSp({})} />
      <Modal open={creating} title="নতুন খানা" forceRender onCancel={() => setCreating(false)} onOk={create} okText="তৈরি করুন" cancelText="বাতিল">
        <Form form={form} layout="vertical">
          <Form.Item name="head_farmer_id" label="খানাপ্রধান" rules={[{ required: true, message: 'খানাপ্রধান বাছাই করুন' }]}>
            <FarmerPicker />
          </Form.Item>
          <Form.Item name="remarks" label="মন্তব্য">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
