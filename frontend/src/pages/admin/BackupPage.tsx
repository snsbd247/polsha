import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, Input, Space, Table, Tag, Tooltip } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, CloudDownloadOutlined, DatabaseOutlined, MailOutlined } from '@ant-design/icons'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { fmtBytes, fmtDateTime } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import PageFrame from '../../components/PageFrame'

type Backup = {
  id: number
  filename: string
  size: number
  type: string
  created_at: string
  creator: { name_bn: string } | null
  emailed_to: string | null
  emailed_at: string | null
  email_error: string | null
}
type OffSite = { backup_email: string; zip_password_set: boolean; mailer: string }

const TYPE_TAG: Record<string, [string | undefined, string]> = {
  auto: [undefined, tx('স্বয়ংক্রিয়')],
  'pre-deploy': ['purple', tx('আপডেটের আগে')],
}

export default function BackupPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [running, setRunning] = useState(false)
  const [sending, setSending] = useState<number | null>(null)
  const [form] = Form.useForm()

  const { data, isFetching } = useQuery({
    queryKey: ['backups', page],
    queryFn: async () => (await api.get<Paginated<Backup>>('/backups', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })
  const offsite = useQuery({ queryKey: ['backup-settings'], queryFn: async () => (await api.get<OffSite>('/backups/settings')).data })

  const run = async () => {
    setRunning(true)
    try {
      await api.post('/backups', null, { timeout: 10 * 60_000 })
      message.success(tx('ব্যাকআপ তৈরি হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const saveOffsite = async (clear = false) => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.put('/backups/settings', { backup_email: v.backup_email || null, zip_password: v.zip_password || null, clear_zip_password: clear })
      message.success(tx('সংরক্ষিত হয়েছে।'))
      form.setFieldValue('zip_password', '')
      queryClient.invalidateQueries({ queryKey: ['backup-settings'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const email = async (b: Backup) => {
    setSending(b.id)
    try {
      const r = await api.post<{ message: string }>(`/backups/${b.id}/email`, null, { timeout: 5 * 60_000 })
      message.success(r.data.message)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSending(null)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    }
  }

  const download = async (b: Backup) => {
    try {
      const res = await api.get(`/backups/${b.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = b.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const o = offsite.data
  return (
    <PageFrame
      className="ml pl"
      crumbs={[{ label: tx('প্রশাসন'), to: '/admin/users' }, { label: tx('ব্যাকআপ') }]}
      title={tx('ব্যাকআপ')}
      actions={
        <span className="id-actions no-print">
          <Button type="primary" icon={<DatabaseOutlined />} loading={running} onClick={run}>
            {tx('এখনই ব্যাকআপ নিন')}
          </Button>
        </span>
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('প্রতিদিন রাত ২টায় স্বয়ংক্রিয় ব্যাকআপ হয় এবং ৩০ দিনের ব্যাকআপ রাখা হয়। গুরুত্বপূর্ণ ব্যাকআপ ডাউনলোড করে নিরাপদ জায়গায় রাখুন।')} />

      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={
          <>
            <MailOutlined /> {tx('সার্ভারের বাইরে কপি (ইমেইল)')}
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          {tx('সার্ভার নষ্ট হলে সার্ভারের ব্যাকআপও হারাবে। ঠিকানা দিলে প্রতি রাতের ব্যাকআপ এই ইমেইলে যাবে। পাসওয়ার্ড দিলে ফাইলটি পাসওয়ার্ড-সুরক্ষিত জিপে যাবে — পাসওয়ার্ডটি আলাদা জায়গায় লিখে রাখুন, হারালে ফাইল খোলা যাবে না।')}
        </p>
        {o && (
          <Form form={form} layout="vertical" initialValues={{ backup_email: o.backup_email }} key={o.backup_email}>
            <Space wrap align="end">
              <Form.Item name="backup_email" label={tx('ইমেইল ঠিকানা')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]} style={{ marginBottom: 0, minWidth: 280 }}>
                <Input placeholder="name@gmail.com" />
              </Form.Item>
              <Form.Item
                name="zip_password"
                label={o.zip_password_set ? tx('জিপ পাসওয়ার্ড (দেওয়া আছে — বদলাতে নতুনটি লিখুন)') : tx('জিপ পাসওয়ার্ড (ঐচ্ছিক, অন্তত ৮ অক্ষর)')}
                rules={[{ min: 8, message: tx('অন্তত ৮ অক্ষর') }]}
                style={{ marginBottom: 0, minWidth: 280 }}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" onClick={() => saveOffsite()}>
                {tx('সংরক্ষণ')}
              </Button>
              {o.zip_password_set && <Button onClick={() => saveOffsite(true)}>{tx('পাসওয়ার্ড তুলে দিন')}</Button>}
            </Space>
          </Form>
        )}
        {o?.mailer === 'log' && <Alert type="warning" showIcon style={{ marginTop: 12 }} title={tx('সার্ভারে ইমেইল পাঠানো চালু নেই (MAIL_MAILER=log) — ইমেইল শুধু লগে লেখা হবে।')} />}
      </Card>

      <Table<Backup>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 760 }}
        pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: tx('তারিখ'), dataIndex: 'created_at', render: fmtDateTime },
          { title: tx('ফাইল'), dataIndex: 'filename' },
          { title: tx('আকার'), dataIndex: 'size', render: fmtBytes },
          {
            title: tx('ধরন'),
            dataIndex: 'type',
            render: (t: string) => {
              const [color, label] = TYPE_TAG[t] ?? ['blue', tx('হাতে নেওয়া')]
              return <Tag color={color}>{label}</Tag>
            },
          },
          { title: tx('যিনি নিয়েছেন'), render: (_, b) => b.creator?.name_bn ?? tx('সিস্টেম') },
          {
            title: tx('ইমেইলে কপি'),
            render: (_, b) =>
              b.emailed_at ? (
                <Tooltip title={`${b.emailed_to} · ${fmtDateTime(b.emailed_at)}`}>
                  <Tag color="green" icon={<CheckCircleFilled />}>
                    {tx('পাঠানো হয়েছে')}
                  </Tag>
                </Tooltip>
              ) : b.email_error ? (
                <Tooltip title={b.email_error}>
                  <Tag color="red" icon={<CloseCircleFilled />}>
                    {tx('পাঠানো যায়নি')}
                  </Tag>
                </Tooltip>
              ) : (
                '—'
              ),
          },
          {
            title: '',
            width: 100,
            render: (_, b) => (
              <Space>
                <Button icon={<CloudDownloadOutlined />} onClick={() => download(b)} aria-label={tx('ডাউনলোড')} />
                <Tooltip title={tx('ইমেইলে পাঠান')}>
                  <Button icon={<MailOutlined />} loading={sending === b.id} disabled={!o?.backup_email} onClick={() => email(b)} aria-label={tx('ইমেইলে পাঠান')} />
                </Tooltip>
              </Space>
            ),
          },
        ]}
      />
    </PageFrame>
  )
}
