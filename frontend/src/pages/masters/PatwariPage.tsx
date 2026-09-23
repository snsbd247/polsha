import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Drawer, Form, Input, Modal, Select, Switch, Table, Tag, Timeline } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { mobileRules, required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'

type Assignment = { id: number; mouza_id: number; start_date: string; end_date: string | null; mouza: { id: number; name_bn: string; jl_no: string } }
type Patwari = {
  id: number
  name: string
  father_name: string
  mobile: string
  nid: string | null
  farmer_id: number | null
  farmer: { id: number; farmer_code: string; name_bn: string } | null
  is_active: boolean
  current_assignments: Assignment[]
  assignments?: Assignment[]
}

export default function PatwariPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params, setParams] = useState<{ page: number; per_page: number; search?: string; mouza_id?: number }>({ page: 1, per_page: 25 })
  const [editing, setEditing] = useState<Patwari | 'new' | null>(null)
  const [historyFor, setHistoryFor] = useState<number | null>(null)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['patwaris', params],
    queryFn: async () => (await api.get<Paginated<Patwari>>('/patwaris', { params })).data,
    placeholderData: keepPreviousData,
  })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const history = useQuery({
    queryKey: ['patwaris', historyFor, 'detail'],
    queryFn: async () => (await api.get<Patwari>(`/patwaris/${historyFor}`)).data,
    enabled: !!historyFor,
  })
  const mouzaOptions = mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))

  const open = (p: Patwari | 'new') => {
    setEditing(p)
    form.resetFields()
    form.setFieldsValue(
      p === 'new'
        ? { is_active: true, start_date: dayjs(), mouza_ids: [] }
        : { ...p, start_date: dayjs(), mouza_ids: p.current_assignments.map((a) => a.mouza_id) },
    )
  }

  const save = async () => {
    const v = await form.validateFields()
    const payload = { ...v, mobile: toEnDigits(v.mobile), nid: v.nid ? toEnDigits(v.nid) : null, start_date: (v.start_date as Dayjs).format('YYYY-MM-DD') }
    try {
      if (editing === 'new') await api.post('/patwaris', payload)
      else await api.put(`/patwaris/${(editing as Patwari).id}`, payload)
      message.success('সংরক্ষণ হয়েছে।')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['patwaris'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>পাতওয়ারী</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Can perm="patwari.export">
            <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/patwaris/export', params, 'patwaris.csv').catch((e) => message.error(errorMessage(e)))}>
              Excel
            </Button>
          </Can>
          <Can perm="patwari.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              নতুন পাতওয়ারী
            </Button>
          </Can>
        </div>
      </div>
      <div className="toolbar">
        <Input.Search placeholder="নাম বা মোবাইল" allowClear style={{ width: 240 }} onSearch={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <Select placeholder="মৌজা" allowClear showSearch={{ optionFilterProp: 'label' }} style={{ width: 200 }} options={mouzaOptions} onChange={(mouza_id) => setParams((p) => ({ ...p, mouza_id, page: 1 }))} />
      </div>
      <Table<Patwari>
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
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: 'নাম', dataIndex: 'name' },
          { title: 'পিতা', dataIndex: 'father_name' },
          { title: 'মোবাইল', dataIndex: 'mobile', render: digits },
          { title: 'দায়িত্বাধীন মৌজা', render: (_, p) => p.current_assignments.map((a) => <Tag key={a.id}>{a.mouza.name_bn}</Tag>) },
          { title: 'দায়িত্বাধীন জমি', render: () => <span style={{ color: '#999' }}>ফেজ ৩</span> },
          { title: 'অবস্থা', dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">সক্রিয়</Tag> : <Tag>নিষ্ক্রিয়</Tag>) },
          {
            title: '',
            width: 190,
            render: (_, p) => (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="small" onClick={() => setHistoryFor(p.id)}>
                  ইতিহাস
                </Button>
                {can('patwari.edit') && (
                  <Button size="small" onClick={() => open(p)}>
                    সম্পাদনা
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal open={!!editing} title={editing === 'new' ? 'নতুন পাতওয়ারী' : 'পাতওয়ারী সম্পাদনা'} onCancel={() => setEditing(null)} onOk={save} okText="সংরক্ষণ" cancelText="বাতিল" forceRender width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="নাম" rules={[required('নাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="father_name" label="পিতার নাম" rules={[required('পিতার নাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="mobile" label="মোবাইল" rules={mobileRules}>
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item name="nid" label="NID">
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item name="mouza_ids" label="দায়িত্বাধীন মৌজা" rules={[{ required: true, type: 'array', min: 1, message: 'কমপক্ষে একটি মৌজা দিন' }]}>
            <Select mode="multiple" showSearch={{ optionFilterProp: 'label' }} options={mouzaOptions} />
          </Form.Item>
          <Form.Item name="start_date" label={editing === 'new' ? 'দায়িত্ব শুরুর তারিখ' : 'মৌজা পরিবর্তন কার্যকর তারিখ'} rules={[required('তারিখ দিন')]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="farmer_id" label="নিজেও কৃষক হলে (ঐচ্ছিক)">
            <FarmerPicker initialLabel={editing && editing !== 'new' && editing.farmer ? `${editing.farmer.name_bn} (${editing.farmer.farmer_code})` : undefined} />
          </Form.Item>
          <Form.Item name="is_active" label="অবস্থা" valuePropName="checked">
            <Switch checkedChildren="সক্রিয়" unCheckedChildren="নিষ্ক্রিয়" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer open={!!historyFor} onClose={() => setHistoryFor(null)} title={`দায়িত্বের ইতিহাস — ${history.data?.name ?? ''}`} size={480}>
        <Timeline
          items={(history.data?.assignments ?? []).map((a) => ({
            color: a.end_date ? 'gray' : 'green',
            content: (
              <>
                <strong>{a.mouza.name_bn}</strong> (JL {digits(a.mouza.jl_no)})
                <div>
                  {fmtDate(a.start_date)} — {a.end_date ? fmtDate(a.end_date) : 'বর্তমান'}
                </div>
              </>
            ),
          }))}
        />
      </Drawer>
    </>
  )
}
