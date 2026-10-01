import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Grid, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ClockCircleFilled, EyeFilled, PlayCircleOutlined, SafetyCertificateFilled, WarningFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import IntegrityResults, { type IntegrityCheck } from '../../components/IntegrityResults'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { Box } from '../irrigation/InvoiceDetailPage'
import ListFrame, { n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../accounting/accounting.css'

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
type Resp = Paginated<Scan> & { latest: Pick<Scan, 'id' | 'total_issues' | 'errors' | 'created_at'> | null; counts: { total: number; with_errors: number } }

function ScanDetail({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ['integrity-scan', id], queryFn: async () => (await api.get<Scan>(`/integrity-scans/${id}`)).data })
  if (!data) return <Spin />
  const group = (g: string) => (data.results ?? []).filter((r) => r.group === g)
  return (
    <>
      <Alert
        type={data.errors ? 'error' : data.total_issues ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 16 }}
        title={tx('মোট অসঙ্গতি {{p0}}টি, তার মধ্যে গুরুতর {{p1}}টি।', { p0: digits(data.total_issues), p1: digits(data.errors) })}
      />
      <Box icon={<SafetyCertificateFilled />} title={tx('জমি, কৃষক ও মৌজার তথ্য')} className="li-box">
        <div className="li-body">
          <IntegrityResults checks={group('data')} />
        </div>
      </Box>
      <Box icon={<SafetyCertificateFilled />} title={tx('হিসাব ও খতিয়ান')} className="li-box">
        <div className="li-body">
          <IntegrityResults checks={group('ledger')} />
        </div>
      </Box>
    </>
  )
}

/** Stored full scans (nightly + on demand); open one to see every check and sample records. */
export default function IntegrityScanPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [open, setOpen] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const { data, isFetching } = useQuery({
    queryKey: ['integrity-scans', page, perPage],
    queryFn: async () => (await api.get<Resp>('/integrity-scans', { params: { page, per_page: perPage } })).data,
    placeholderData: keepPreviousData,
  })
  const l = data?.latest
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
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

  const cards = [
    {
      key: 'last',
      label: l ? tx('সর্বশেষ স্ক্যান · {{p0}}', { p0: fmtDate(l.created_at) }) : tx('সর্বশেষ স্ক্যান'),
      value: data ? (l ? l.total_issues : '—') : undefined,
      unit: l ? tx('অসঙ্গতি') : undefined,
      icon: '',
      glyph: <ClockCircleFilled />,
      color: '#1769e0',
      tint: '#e4edfd',
      onClick: l ? () => setOpen(l.id) : undefined,
    },
    { key: 'errors', label: tx('সর্বশেষ স্ক্যানে গুরুতর'), value: data ? (l?.errors ?? 0) : undefined, icon: '', glyph: <WarningFilled />, color: l?.errors ? '#e5383b' : '#1f9d55', tint: l?.errors ? '#fde4e5' : '#dcf3e5' },
    { key: 'total', label: tx('মোট স্ক্যান'), value: data?.counts.total, icon: '', glyph: <SafetyCertificateFilled />, color: '#8b3fe0', tint: '#efe4fc' },
    { key: 'bad', label: tx('গুরুতর সমস্যা পাওয়া স্ক্যান'), value: data?.counts.with_errors, icon: '', glyph: <WarningFilled />, color: '#f08c00', tint: '#fdefd6' },
  ]

  const columns: ColumnsType<Scan> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
    { title: tx('ধরন'), dataIndex: 'trigger', render: (v: string) => (v === 'auto' ? <Tag className="fl-tag ll-gray">{tx('স্বয়ংক্রিয়')}</Tag> : <Tag className="fl-tag ll-blue">{tx('হাতে চালানো')}</Tag>) },
    { title: tx('চালিয়েছেন'), render: (_, s) => nameOf(s.creator) || tx('সিস্টেম') },
    { title: tx('মোট অসঙ্গতি'), dataIndex: 'total_issues', align: 'right', render: (v: number) => n0(v) },
    { title: tx('গুরুতর'), dataIndex: 'errors', align: 'center', render: (v: number) => <Tag className={`fl-tag ${v ? 'fl-tag-red' : 'fl-tag-green'}`}>{digits(v)}</Tag> },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, s) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setOpen(s.id)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('অডিট ও পর্যবেক্ষণ'), to: '/audit/logs' }}
      title={tx('ডেটা সঠিকতা স্ক্যান')}
      subtitle=""
      actions={
        can('audit.view') && (
          <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={run}>
            {tx('এখনই স্ক্যান করুন')}
          </Button>
        )
      }
      cards={cards}
      above={<Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('প্রতি রাতে ১:৩০-এ স্বয়ংক্রিয় স্ক্যান চলে। জমি/কৃষকের তথ্য, ভাউচার পোস্টিং ও মডিউল বনাম খতিয়ান — সব যাচাই হয়।')} />}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('স্ক্যানের তালিকা'), p1: n0(total) })}
      paging={{
        page,
        perPage,
        total,
        showing: tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: n0(from), p1: n0(Math.min(page * perPage, total)), p2: n0(total) }),
        onPage: setPage,
        onPerPage: (n) => {
          setPerPage(n)
          setPage(1)
        },
      }}
    >
      <Table<Scan>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('এখনও কোনো স্ক্যান হয়নি') }}
      />
      <Drawer open={open !== null} onClose={() => setOpen(null)} size="large" title={tx('স্ক্যানের ফলাফল')} destroyOnHidden>
        {open !== null && <ScanDetail id={open} />}
      </Drawer>
    </ListFrame>
  )
}
