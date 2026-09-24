import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, Drawer, Row, Spin, Statistic, Table, Tag } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import IntegrityResults, { type IntegrityCheck } from '../../components/IntegrityResults'

type Scan = {
  id: number
  trigger: 'manual' | 'auto'
  total_issues: number
  errors: number
  started_at: string
  finished_at: string
  created_at: string
  creator: { id: number; name_bn: string; name_en: string | null } | null
  results?: IntegrityCheck[]
}

function ScanDetail({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ['integrity-scan', id], queryFn: async () => (await api.get<Scan>(`/integrity-scans/${id}`)).data })
  if (!data) return <Spin />
  const group = (g: string) => (data.results ?? []).filter((r) => r.group === g)
  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Statistic title={tx('মোট অসঙ্গতি')} value={digits(data.total_issues)} />
        </Col>
        <Col span={12}>
          <Statistic title={tx('গুরুতর')} value={digits(data.errors)} styles={{ content: { color: data.errors ? '#cf1322' : undefined } }} />
        </Col>
      </Row>
      <Card size="small" title={tx('জমি, কৃষক ও মৌজার তথ্য')} style={{ marginBottom: 16 }}>
        <IntegrityResults checks={group('data')} />
      </Card>
      <Card size="small" title={tx('হিসাব ও খতিয়ান')}>
        <IntegrityResults checks={group('ledger')} />
      </Card>
    </>
  )
}

/** Stored full scans (nightly + on demand); open one to see every check and sample records. */
export default function IntegrityScanPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const { data, isFetching } = useQuery({
    queryKey: ['integrity-scans', page],
    queryFn: async () => (await api.get<Paginated<Scan>>('/integrity-scans', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })
  const run = async () => {
    setRunning(true)
    try {
      const scan = (await api.post<Scan>('/integrity-scans')).data
      message.success(tx('স্ক্যান সম্পন্ন: {{n}} টি অসঙ্গতি।', { n: digits(scan.total_issues) }))
      queryClient.invalidateQueries({ queryKey: ['integrity-scans'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setOpen(scan.id)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('ডেটা সঠিকতা স্ক্যান')}</h2>
        {can('audit.view') && (
          <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={run}>
            {tx('এখনই স্ক্যান করুন')}
          </Button>
        )}
      </div>
      <p style={{ color: '#888' }}>{tx('প্রতি রাতে ১:৩০-এ স্বয়ংক্রিয় স্ক্যান চলে। জমি/কৃষকের তথ্য, ভাউচার পোস্টিং ও মডিউল বনাম খতিয়ান — সব যাচাই হয়।')}</p>
      <Table<Scan>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        pagination={{ current: page, total: data?.total, pageSize: data?.per_page, onChange: setPage }}
        onRow={(s) => ({ onClick: () => setOpen(s.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: tx('সময়'), dataIndex: 'created_at', render: fmtDateTime },
          { title: tx('ধরন'), dataIndex: 'trigger', render: (v: string) => (v === 'auto' ? <Tag>{tx('স্বয়ংক্রিয়')}</Tag> : <Tag color="blue">{tx('হাতে চালানো')}</Tag>) },
          { title: tx('চালিয়েছেন'), render: (_, s) => nameOf(s.creator) },
          { title: tx('মোট অসঙ্গতি'), dataIndex: 'total_issues', align: 'right', render: digits },
          { title: tx('গুরুতর'), dataIndex: 'errors', align: 'right', render: (v: number) => (v ? <Tag color="red">{digits(v)}</Tag> : <Tag color="green">{digits(0)}</Tag>) },
        ]}
      />
      <Drawer open={open !== null} onClose={() => setOpen(null)} size="large" title={tx('স্ক্যানের ফলাফল')} destroyOnHidden>
        {open !== null && <ScanDetail id={open} />}
      </Drawer>
    </>
  )
}
