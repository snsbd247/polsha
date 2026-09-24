import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Popconfirm, Segmented, Space, Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { MAINT_STATUS_COLOR, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import { CompleteModal, journalLink, type Maintenance } from './AssetDetailPage'

type Row = Maintenance & { asset: { id: number; asset_code: string; name_bn: string; name_en: string | null; location: string | null } }
type View = 'due' | 'overdue' | 'd30' | 'done' | 'cancelled'

/** Repair schedule: scheduled service/repair jobs across all assets, and the done log. */
export default function MaintenancePage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useAssetMeta()
  const [view, setView] = useState<View>('due')
  const [page, setPage] = useState(1)
  const [completing, setCompleting] = useState<Maintenance | null>(null)
  const params = {
    page,
    status: view === 'done' || view === 'cancelled' ? view : 'scheduled',
    overdue: view === 'overdue' ? 1 : undefined,
    within_days: view === 'd30' ? 30 : undefined,
  }
  const { data, isFetching } = useQuery({
    queryKey: ['asset-maintenances', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/assets/maintenances', { params })).data,
    placeholderData: keepPreviousData,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-maintenances'] })
    queryClient.invalidateQueries({ queryKey: ['asset-dashboard'] })
  }
  const cancel = async (m: Row) => {
    try {
      await api.post(`/assets/maintenances/${m.id}/cancel`)
      message.success(tx('বাতিল হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const today = dayjs().format('YYYY-MM-DD')

  return (
    <>
      <div className="page-header">
        <h2>{tx('মেরামত ও সার্ভিসের সূচি')}</h2>
      </div>
      <p style={{ color: '#888' }}>{tx('নতুন কাজ নির্ধারণ করতে সম্পদের পাতায় "সার্ভিস/মেরামত নির্ধারণ" চাপুন।')}</p>
      <div className="toolbar">
        <Segmented<View>
          value={view}
          onChange={(v) => {
            setView(v)
            setPage(1)
          }}
          options={[
            { value: 'due', label: tx('সব নির্ধারিত') },
            { value: 'overdue', label: tx('মেয়াদোত্তীর্ণ') },
            { value: 'd30', label: tx('৩০ দিনের মধ্যে') },
            { value: 'done', label: tx('সম্পন্ন') },
            { value: 'cancelled', label: tx('বাতিল') },
          ]}
        />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1000 }}
        pagination={{ current: page, total: data?.total, pageSize: data?.per_page, onChange: setPage }}
        columns={[
          {
            title: tx('নির্ধারিত তারিখ'),
            dataIndex: 'due_on',
            width: 130,
            render: (v: string | null, m) => (v && m.status === 'scheduled' && v < today ? <Tag color="red">{fmtDate(v)}</Tag> : fmtDate(v)),
          },
          {
            title: tx('সম্পদ'),
            render: (_, m) => (
              <Link to={`/assets/${m.asset.id}`}>
                {digits(m.asset.asset_code)} — {nameOf(m.asset)}
              </Link>
            ),
          },
          { title: tx('অবস্থান'), render: (_, m) => m.asset.location },
          { title: tx('ধরন'), dataIndex: 'kind', render: (v: string) => meta.data?.maintenance_kinds[v] ?? v },
          { title: tx('কাজ'), dataIndex: 'title' },
          { title: tx('পুনরাবৃত্তি'), dataIndex: 'repeat_months', render: (v: number | null) => (v ? tx('{{p0}} মাস পর পর', { p0: digits(v) }) : '') },
          ...(view === 'done'
            ? [
                { title: tx('সম্পন্ন'), dataIndex: 'done_on', render: fmtDate },
                { title: tx('খরচ'), dataIndex: 'cost', align: 'right' as const, render: moneyOrBlank },
                { title: tx('মেকানিক / প্রতিষ্ঠান'), dataIndex: 'vendor' },
                { title: tx('ভাউচার'), render: (_: unknown, m: Row) => journalLink(m.journal, can('accounting.view')) },
              ]
            : []),
          { title: tx('স্ট্যাটাস'), dataIndex: 'status', render: (v: string) => <Tag color={MAINT_STATUS_COLOR[v]}>{meta.data?.maintenance_statuses[v] ?? v}</Tag> },
          {
            title: '',
            render: (_, m) =>
              m.status === 'scheduled' && can('asset.edit') ? (
                <Space>
                  <Button size="small" type="primary" onClick={() => setCompleting(m)}>
                    {tx('সম্পন্ন')}
                  </Button>
                  <Popconfirm title={tx('এই কাজ বাতিল করবেন?')} onConfirm={() => cancel(m)}>
                    <Button size="small">{tx('বাতিল')}</Button>
                  </Popconfirm>
                </Space>
              ) : null,
          },
        ]}
      />
      <CompleteModal job={completing} onClose={() => setCompleting(null)} onDone={refresh} />
    </>
  )
}
