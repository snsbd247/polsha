import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { Alert, App, Button, DatePicker, Input, Segmented, Select, Table, Tag, Tooltip } from 'antd'
import { RedoOutlined, SendOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'

type Log = {
  id: number
  template_key: string | null
  mobile: string
  message: string
  status: 'pending' | 'sent' | 'failed' | 'logged'
  attempts: number
  response: string | null
  creator: { name_bn: string; name_en: string | null } | null
  sent_at: string | null
  created_at: string
}
type Resp = Paginated<Log> & {
  counts: Record<string, number>
  statuses: Record<string, string>
  configured: boolean
  templates: { key: string; name_bn: string; name_en: string | null }[]
}

const COLOR: Record<string, string> = { pending: 'gold', sent: 'green', failed: 'red', logged: 'default' }

/** Every SMS the system produced, with retry for failures and a manual "send queued now". */
export default function SmsLogsPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [template, setTemplate] = useState<string>()
  const [q, setQ] = useState('')
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const params = {
    status: status || undefined,
    template_key: template,
    q: q || undefined,
    from: range?.[0]?.format('YYYY-MM-DD'),
    to: range?.[1]?.format('YYYY-MM-DD'),
    page,
  }
  const { data, isFetching } = useQuery({
    queryKey: ['sms-logs', params],
    queryFn: async () => (await api.get<Resp>('/sms/logs', { params })).data,
    placeholderData: keepPreviousData,
  })
  const admin = can(['settings.admin', 'sms.admin'])
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sms-logs'] })

  const retry = async (id: number) => {
    try {
      const log = (await api.post<Log>(`/sms/logs/${id}/retry`)).data
      if (log.status === 'sent') message.success(tx('পাঠানো হয়েছে।'))
      else message.warning(tx('পাঠানো যায়নি: {{r}}', { r: log.response ?? '' }))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const processQueue = async () => {
    setBusy(true)
    try {
      const r = (await api.post<{ sent: number; failed: number }>('/sms/process')).data
      message.success(tx('পাঠানো হয়েছে {{s}}, ব্যর্থ {{f}}।', { s: digits(r.sent ?? 0), f: digits(r.failed ?? 0) }))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const tplName = (key: string | null) => {
    const t = data?.templates.find((x) => x.key === key)
    return t ? nameOf(t) : key ?? tx('পরীক্ষা/সরাসরি')
  }
  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)

  return (
    <>
      <div className="page-header">
        <h2>{tx('SMS লগ')}</h2>
        {admin && (
          <Button icon={<SendOutlined />} loading={busy} onClick={processQueue} disabled={!data?.configured || !data?.counts.pending}>
            {tx('অপেক্ষমাণ এসএমএস এখনই পাঠান')}
          </Button>
        )}
      </div>
      {data && !data.configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <>
              {tx('এসএমএস গেটওয়ে কনফিগার করা নেই — বার্তাগুলো শুধু লগে জমা হচ্ছে।')} {admin && <Link to="/settings/sms">{tx('SMS সেটিংস')}</Link>}
            </>
          }
        />
      )}
      <div className="toolbar">
        <Segmented
          value={status}
          onChange={(v) => {
            setStatus(v as string)
            setPage(1)
          }}
          options={[
            { value: '', label: `${tx('সব')} (${digits(total)})` },
            ...Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label: `${label} (${digits(data?.counts[value] ?? 0)})` })),
          ]}
        />
        <Select
          allowClear
          placeholder={tx('টেমপ্লেট')}
          style={{ width: 200 }}
          value={template}
          onChange={(v) => {
            setTemplate(v)
            setPage(1)
          }}
          options={data?.templates.map((t) => ({ value: t.key, label: nameOf(t) }))}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          value={range}
          onChange={(v) => {
            setRange(v)
            setPage(1)
          }}
        />
        <Input.Search
          allowClear
          placeholder={tx('মোবাইল বা বার্তা')}
          style={{ width: 220 }}
          onSearch={(v) => {
            setQ(v)
            setPage(1)
          }}
        />
      </div>
      <Table<Log>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
        pagination={{ current: page, total: data?.total, pageSize: data?.per_page, onChange: setPage }}
        columns={[
          { title: tx('সময়'), dataIndex: 'created_at', width: 150, render: fmtDateTime },
          { title: tx('মোবাইল'), dataIndex: 'mobile', width: 130, render: digits },
          { title: tx('টেমপ্লেট'), dataIndex: 'template_key', width: 160, render: tplName },
          { title: tx('বার্তা'), dataIndex: 'message', ellipsis: { showTitle: true } },
          {
            title: tx('অবস্থা'),
            dataIndex: 'status',
            width: 120,
            render: (v: string, r) => (
              <Tooltip title={r.response}>
                <Tag color={COLOR[v]}>{data?.statuses[v] ?? v}</Tag>
              </Tooltip>
            ),
          },
          { title: tx('চেষ্টা'), dataIndex: 'attempts', width: 70, align: 'right', render: digits },
          { title: tx('পাঠানোর সময়'), dataIndex: 'sent_at', width: 150, render: fmtDateTime },
          { title: tx('যিনি'), width: 120, render: (_, r) => nameOf(r.creator) },
          {
            title: '',
            width: 90,
            render: (_, r) =>
              admin && r.status === 'failed' ? (
                <Button size="small" icon={<RedoOutlined />} onClick={() => retry(r.id)}>
                  {tx('আবার')}
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  )
}
