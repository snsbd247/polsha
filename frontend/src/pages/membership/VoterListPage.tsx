import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Drawer, Form, Input, Modal, Space, Table, Tabs } from 'antd'
import { DownloadOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { usePublicSettings } from '../../lib/settings'

type VoterList = { id: number; title: string; cutoff_date: string; min_months: number; eligible_count: number; ineligible_count: number; created_at: string; creator: { name_bn: string } | null }
type Item = { id: number; serial: number | null; member_no: number; name: string; father_name: string; village: string | null; eligible: boolean; reason: string | null }

function ListDrawer({ list, onClose }: { list: VoterList | null; onClose: () => void }) {
  const { message } = App.useApp()
  const { data: settings } = usePublicSettings()
  const [tab, setTab] = useState<'1' | '0'>('1')
  const [page, setPage] = useState(1)

  const { data, isFetching } = useQuery({
    queryKey: ['voter-lists', list?.id, tab, page],
    queryFn: async () => (await api.get<{ items: Paginated<Item> }>(`/voter-lists/${list!.id}`, { params: { eligible: tab, page, per_page: 100 } })).data.items,
    enabled: !!list,
    placeholderData: keepPreviousData,
  })

  return (
    <Drawer open={!!list} onClose={onClose} size={900} title={list?.title}>
      {list && (
        <>
          <div className="print-only" style={{ textAlign: 'center' }}>
            <h2 style={{ margin: 0 }}>{settings?.society_name_bn}</h2>
            <div>
              {list.title} — কাট-অফ তারিখ {fmtDate(list.cutoff_date)}
            </div>
          </div>
          <Space className="no-print" style={{ marginBottom: 12 }} wrap>
            <Can perm="member.export">
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadExport(`/voter-lists/${list.id}/export`, { eligible: tab }, tab === '1' ? 'voters.csv' : 'voter-audit.csv').catch((e) => message.error(errorMessage(e)))}
              >
                Excel
              </Button>
            </Can>
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              প্রিন্ট
            </Button>
          </Space>
          <Tabs
            className="no-print"
            activeKey={tab}
            onChange={(k) => {
              setTab(k as '1' | '0')
              setPage(1)
            }}
            items={[
              { key: '1', label: `ভোটার (${digits(list.eligible_count)})` },
              { key: '0', label: `বাদ পড়েছেন / Voter Audit (${digits(list.ineligible_count)})` },
            ]}
          />
          <Table<Item>
            rowKey="id"
            size="small"
            bordered
            loading={isFetching}
            dataSource={data?.data}
            pagination={{ current: page, pageSize: 100, total: data?.total, onChange: setPage, showSizeChanger: false }}
            columns={
              tab === '1'
                ? [
                    { title: 'ক্রমিক', dataIndex: 'serial', width: 70, render: digits },
                    { title: 'সদস্য নং', dataIndex: 'member_no', render: digits },
                    { title: 'নাম', dataIndex: 'name' },
                    { title: 'পিতা', dataIndex: 'father_name' },
                    { title: 'গ্রাম', dataIndex: 'village' },
                    { title: 'স্বাক্ষর', width: 140, render: () => '' },
                  ]
                : [
                    { title: 'সদস্য নং', dataIndex: 'member_no', render: digits },
                    { title: 'নাম', dataIndex: 'name' },
                    { title: 'পিতা', dataIndex: 'father_name' },
                    { title: 'গ্রাম', dataIndex: 'village' },
                    { title: 'বাদ পড়ার কারণ', dataIndex: 'reason' },
                  ]
            }
          />
        </>
      )}
    </Drawer>
  )
}

export default function VoterListPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<VoterList | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['voter-lists', 'index', page],
    queryFn: async () => (await api.get<Paginated<VoterList>>('/voter-lists', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })

  const create = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const r = await api.post<VoterList>('/voter-lists', { title: v.title, cutoff_date: (v.cutoff_date as Dayjs).format('YYYY-MM-DD') })
      message.success('ভোটার তালিকা তৈরি হয়েছে।')
      setCreating(false)
      queryClient.invalidateQueries({ queryKey: ['voter-lists'] })
      setOpen(r.data)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>ভোটার তালিকা</h2>
        <Can perm="member.admin">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.setFieldsValue({ title: `বার্ষিক সাধারণ সভা ${dayjs().format('YYYY')}`, cutoff_date: dayjs() })
              setCreating(true)
            }}
          >
            নতুন তালিকা তৈরি
          </Button>
        </Can>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="কাট-অফ তারিখে যারা সক্রিয় সদস্য, তারা সবাই ভোটার। তালিকা তৈরির সময়ের তথ্য স্থায়ীভাবে সংরক্ষিত থাকে — পরে কারো তথ্য বদলালেও ছাপা তালিকা বদলাবে না।"
      />
      <Table<VoterList>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 700 }}
        onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: 'pointer' } })}
        pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'শিরোনাম', dataIndex: 'title' },
          { title: 'কাট-অফ তারিখ', dataIndex: 'cutoff_date', render: fmtDate },
          { title: 'ভোটার', dataIndex: 'eligible_count', render: digits },
          { title: 'বাদ পড়েছেন', dataIndex: 'ineligible_count', render: digits },
          { title: 'তৈরি', render: (_, r) => `${r.creator?.name_bn ?? ''} · ${fmtDateTime(r.created_at)}` },
        ]}
      />
      <ListDrawer list={open} onClose={() => setOpen(null)} />
      <Modal open={creating} title="নতুন ভোটার তালিকা" forceRender onCancel={() => setCreating(false)} onOk={create} confirmLoading={saving} okText="তৈরি করুন" cancelText="বাতিল">
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="শিরোনাম" rules={[required('শিরোনাম দিন')]}>
            <Input />
          </Form.Item>
          <Form.Item name="cutoff_date" label="কাট-অফ তারিখ" rules={[required('তারিখ দিন')]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
