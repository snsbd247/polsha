import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, Modal, Select, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Can, useAuth } from '../../auth/AuthContext'
import LocationCascader, { type LocationPath } from '../../components/LocationCascader'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, toEnDigits } from '../../lib/format'
import { required } from '../../lib/rules'
import type { LocationItem, Mouza } from '../../lib/types'

type Params = { page: number; per_page: number; search?: string; union_id?: number; upazila_id?: number }

export default function MouzaPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const [filterPath, setFilterPath] = useState<LocationPath>([])
  const [editing, setEditing] = useState<Mouza | 'new' | null>(null)
  const [formPath, setFormPath] = useState<LocationPath>([])
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['mouzas', params],
    queryFn: async () => (await api.get<Paginated<Mouza>>('/mouzas', { params })).data,
    placeholderData: keepPreviousData,
  })

  const unionId = formPath[3]
  const villages = useQuery({
    queryKey: ['locations', 'villages', unionId ?? null, 'active'],
    queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { parent_id: unionId, active_only: 1 } })).data,
    enabled: !!unionId,
  })

  const openForm = async (m: Mouza | 'new') => {
    setEditing(m)
    if (m === 'new') {
      setFormPath(filterPath.slice(0, 4))
      form.setFieldsValue({ name_bn: '', name_en: '', jl_no: '', village_ids: [], is_active: true })
    } else {
      const full = (await api.get(`/mouzas/${m.id}`)).data
      const u = full.union
      setFormPath([u.upazila.district.division_id, u.upazila.district_id, u.upazila_id, u.id])
      form.setFieldsValue({ ...m, village_ids: full.villages.map((v: { id: number }) => v.id) })
    }
  }

  const save = async () => {
    const values = await form.validateFields()
    if (!unionId) {
      message.error('ইউনিয়ন বাছাই করুন।')
      return
    }
    const payload = { ...values, union_id: unionId, jl_no: toEnDigits(String(values.jl_no)) }
    try {
      if (editing === 'new') await api.post('/mouzas', payload)
      else await api.put(`/mouzas/${(editing as Mouza).id}`, payload)
      message.success('সংরক্ষণ হয়েছে।')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['mouzas'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>মৌজা</h2>
        <Can perm="mouza.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm('new')}>
            নতুন মৌজা
          </Button>
        </Can>
      </div>
      <div className="toolbar">
        <Input.Search placeholder="নাম বা JL নম্বর" allowClear style={{ width: 220 }} onSearch={(search) => setParams((p) => ({ ...p, search: toEnDigits(search), page: 1 }))} />
        <LocationCascader
          depth={4}
          value={filterPath}
          onChange={(v) => {
            setFilterPath(v)
            setParams((p) => ({ ...p, page: 1, upazila_id: v[3] ? undefined : v[2], union_id: v[3] }))
          }}
        />
      </div>
      <Table<Mouza>
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
          { title: 'মৌজা', dataIndex: 'name_bn' },
          { title: 'JL নম্বর', dataIndex: 'jl_no', render: digits },
          { title: 'ইউনিয়ন', render: (_, m) => m.union?.name_bn },
          { title: 'উপজেলা', render: (_, m) => m.upazila?.name_bn },
          { title: 'গ্রাম', render: (_, m) => m.villages?.map((v) => <Tag key={v.id}>{v.name_bn}</Tag>) },
          { title: 'অবস্থা', dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">সক্রিয়</Tag> : <Tag>নিষ্ক্রিয়</Tag>) },
          ...(can('mouza.edit') ? [{ title: '', width: 100, render: (_: unknown, m: Mouza) => <Button onClick={() => openForm(m)}>সম্পাদনা</Button> }] : []),
        ]}
      />
      <Modal
        open={!!editing}
        title={editing === 'new' ? 'নতুন মৌজা' : 'মৌজা সম্পাদনা'}
        onCancel={() => setEditing(null)}
        onOk={save}
        okText="সংরক্ষণ"
        cancelText="বাতিল"
        forceRender
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="এলাকা (ইউনিয়ন পর্যন্ত)" required>
            <LocationCascader depth={4} value={formPath} onChange={(v) => {
              setFormPath(v)
              form.setFieldValue('village_ids', [])
            }} />
          </Form.Item>
          <Form.Item name="name_bn" label="মৌজার নাম (বাংলা)" rules={[required('নাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label="মৌজার নাম (ইংরেজি)">
            <Input />
          </Form.Item>
          <Form.Item name="jl_no" label="JL নম্বর / মৌজা কোড" rules={[required('JL নম্বর দিন')]}>
            <Input style={{ maxWidth: 200 }} />
          </Form.Item>
          <Form.Item name="village_ids" label="অন্তর্ভুক্ত গ্রাম">
            <Select
              mode="multiple"
              disabled={!unionId}
              placeholder={unionId ? 'গ্রাম বাছাই করুন' : 'আগে ইউনিয়ন বাছাই করুন'}
              options={villages.data?.map((v) => ({ value: v.id, label: v.name_bn }))}
              showSearch={{ optionFilterProp: 'label' }}
            />
          </Form.Item>
          <Form.Item name="is_active" label="অবস্থা" valuePropName="checked">
            <Switch checkedChildren="সক্রিয়" unCheckedChildren="নিষ্ক্রিয়" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
