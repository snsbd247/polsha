import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Input, Popconfirm, Segmented, Table, Tag, Tooltip } from 'antd'
import { CheckOutlined, DeleteOutlined, ExportOutlined, MailOutlined, PhoneOutlined } from '@ant-design/icons'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { appPath } from '../../lib/phase8'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import SettingsShell from './SettingsShell'

type Msg = {
  id: number
  name: string
  mobile: string
  email: string | null
  subject: string
  message: string
  read_at: string | null
  reader: { name_bn: string; name_en: string | null } | null
  note: string | null
  created_at: string
}
type Resp = Paginated<Msg> & { unread: number; total_all: number }

/** What visitors sent through the website's contact form. */
export default function WebsiteMessagesPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('unread')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const params = { status: status || undefined, search: search || undefined, page }
  const { data, isFetching } = useQuery({
    queryKey: ['website-messages', params],
    queryFn: async () => (await api.get<Resp>('/website-messages', { params })).data,
    placeholderData: keepPreviousData,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['website-messages'] })

  const save = async (id: number, body: { read?: boolean; note?: string | null }) => {
    try {
      await api.put(`/website-messages/${id}`, body)
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const remove = async (id: number) => {
    try {
      message.success((await api.delete<{ message: string }>(`/website-messages/${id}`)).data.message)
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <SettingsShell
      title={tx('ওয়েবসাইটের বার্তা')}
      subtitle={tx('ওয়েবসাইটের "যোগাযোগ করুন" পাতা থেকে পাঠানো বার্তা। ফোন করে উত্তর দিন, তারপর পড়া হয়েছে চিহ্ন দিন।')}
      extra={
        <Button icon={<ExportOutlined />} href={appPath('/contact')} target="_blank">
          {tx('যোগাযোগ পাতা দেখুন')}
        </Button>
      }
    >
      <div className="toolbar">
        <Segmented
          value={status}
          onChange={(v) => {
            setStatus(v as string)
            setPage(1)
          }}
          options={[
            { value: 'unread', label: `${tx('নতুন')} (${digits(data?.unread ?? 0)})` },
            { value: 'read', label: tx('পড়া হয়েছে') },
            { value: '', label: `${tx('সব')} (${digits(data?.total_all ?? 0)})` },
          ]}
        />
        <Input.Search
          allowClear
          placeholder={tx('নাম, মোবাইল বা বার্তা')}
          style={{ width: 260, maxWidth: '100%' }}
          onSearch={(v) => {
            setSearch(v)
            setPage(1)
          }}
        />
      </div>
      <Table<Msg>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
        locale={{ emptyText: status === 'unread' ? tx('নতুন কোনো বার্তা নেই।') : tx('কোনো বার্তা নেই।') }}
        pagination={{ current: page, total: data?.total, pageSize: data?.per_page, onChange: setPage, size: 'small', showLessItems: true, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (r) => (
            <div className="wm-detail">
              <p className="wm-text">{r.message}</p>
              <Input.TextArea
                key={`${r.id}-${r.note ?? ''}`}
                defaultValue={r.note ?? ''}
                maxLength={500}
                autoSize={{ minRows: 1, maxRows: 4 }}
                placeholder={tx('কী করা হলো, তার নোট (যেমন: ফোনে কথা হয়েছে)')}
                onBlur={(e) => e.target.value !== (r.note ?? '') && save(r.id, { note: e.target.value || null })}
              />
            </div>
          ),
        }}
        rowClassName={(r) => (r.read_at ? '' : 'wm-unread')}
        columns={[
          { title: tx('সময়'), dataIndex: 'created_at', width: 150, render: fmtDateTime },
          {
            title: tx('প্রেরক'),
            width: 200,
            render: (_, r) => (
              <>
                <b>{r.name}</b>
                <div>
                  <a href={`tel:${r.mobile}`}>
                    <PhoneOutlined /> {digits(r.mobile)}
                  </a>
                </div>
                {r.email && (
                  <a href={`mailto:${r.email}`}>
                    <MailOutlined /> {r.email}
                  </a>
                )}
              </>
            ),
          },
          { title: tx('বিষয়'), dataIndex: 'subject', width: 170 },
          { title: tx('বার্তা'), dataIndex: 'message', ellipsis: { showTitle: true } },
          {
            title: tx('অবস্থা'),
            width: 140,
            render: (_, r) =>
              r.read_at ? (
                <Tooltip title={`${nameOf(r.reader)} · ${fmtDateTime(r.read_at)}`}>
                  <Tag color="green">{tx('পড়া হয়েছে')}</Tag>
                </Tooltip>
              ) : (
                <Tag color="blue">{tx('নতুন')}</Tag>
              ),
          },
          {
            title: '',
            width: 150,
            render: (_, r) => (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Button size="small" icon={<CheckOutlined />} onClick={() => save(r.id, { read: !r.read_at })}>
                  {r.read_at ? tx('নতুন করুন') : tx('পড়া হয়েছে')}
                </Button>
                <Popconfirm title={tx('বার্তাটি মুছে ফেলবেন?')} onConfirm={() => remove(r.id)} okButtonProps={{ danger: true }}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} />
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />
    </SettingsShell>
  )
}
