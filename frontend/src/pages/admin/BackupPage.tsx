import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Table, Tag } from 'antd'
import { CloudDownloadOutlined, DatabaseOutlined } from '@ant-design/icons'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { fmtBytes, fmtDateTime } from '../../lib/format'
import { t as tx } from '../../lib/i18n'

type Backup = { id: number; filename: string; size: number; type: string; created_at: string; creator: { name_bn: string } | null }

export default function BackupPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [running, setRunning] = useState(false)

  const { data, isFetching } = useQuery({
    queryKey: ['backups', page],
    queryFn: async () => (await api.get<Paginated<Backup>>('/backups', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })

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

  return (
    <>
      <div className="page-header">
        <h2>{tx('ব্যাকআপ')}</h2>
        <Button type="primary" icon={<DatabaseOutlined />} loading={running} onClick={run}>
          {tx('এখনই ব্যাকআপ নিন')}
        </Button>
      </div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={tx('প্রতিদিন রাত ২টায় স্বয়ংক্রিয় ব্যাকআপ হয় এবং ৩০ দিনের ব্যাকআপ রাখা হয়। গুরুত্বপূর্ণ ব্যাকআপ ডাউনলোড করে নিরাপদ জায়গায় রাখুন।')} />
      <Table<Backup>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 600 }}
        pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: tx('তারিখ'), dataIndex: 'created_at', render: fmtDateTime },
          { title: tx('ফাইল'), dataIndex: 'filename' },
          { title: tx('আকার'), dataIndex: 'size', render: fmtBytes },
          { title: tx('ধরন'), dataIndex: 'type', render: (t) => (t === 'auto' ? <Tag>{tx('স্বয়ংক্রিয়')}</Tag> : <Tag color="blue">{tx('হাতে নেওয়া')}</Tag>) },
          { title: tx('যিনি নিয়েছেন'), render: (_, b) => b.creator?.name_bn ?? tx('সিস্টেম') },
          { title: '', width: 60, render: (_, b) => <Button icon={<CloudDownloadOutlined />} onClick={() => download(b)} aria-label={tx('ডাউনলোড')} /> },
        ]}
      />
    </>
  )
}
