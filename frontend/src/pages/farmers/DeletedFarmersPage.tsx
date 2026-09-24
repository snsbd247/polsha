import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Input, Popconfirm, Table } from 'antd'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'

type Named = { id: number; name_bn: string; name_en: string | null } | null
type Row = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string | null
  mobile: string | null
  nid: string | null
  deleted_at: string
  village: Named
  mouza: Named
  deleted_by: Named
  reason: string | null
}

/** Soft-deleted farmers with who deleted them and why; restore brings the record (and its history) back. */
export default function DeletedFarmersPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = { q: q || undefined, page }
  const { data, isFetching } = useQuery({
    queryKey: ['farmers-deleted', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/farmers-deleted', { params })).data,
    placeholderData: keepPreviousData,
  })
  const restore = async (f: Row) => {
    try {
      await api.post(`/farmers/${f.id}/restore`)
      message.success(tx('কৃষক পুনরুদ্ধার করা হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['farmers-deleted'] })
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('মুছে ফেলা কৃষক')}</h2>
      </div>
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder={tx('নাম, আইডি, মোবাইল বা NID')}
          style={{ maxWidth: 320 }}
          onSearch={(v) => {
            setQ(v)
            setPage(1)
          }}
        />
      </div>
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 900 }}
        pagination={{ current: page, total: data?.total, pageSize: data?.per_page, onChange: setPage }}
        columns={[
          { title: tx('আইডি'), dataIndex: 'farmer_code', width: 110, render: digits },
          {
            title: tx('নাম'),
            render: (_, f) => (
              <>
                {nameOf(f)}
                {f.father_name && <div style={{ fontSize: 12, color: '#888' }}>{tx('পিতা: {{n}}', { n: f.father_name })}</div>}
              </>
            ),
          },
          { title: tx('মোবাইল'), dataIndex: 'mobile', render: digits },
          { title: tx('গ্রাম / মৌজা'), render: (_, f) => [nameOf(f.village), nameOf(f.mouza)].filter(Boolean).join(', ') },
          { title: tx('মুছেছেন'), render: (_, f) => nameOf(f.deleted_by) },
          { title: tx('মুছার সময়'), dataIndex: 'deleted_at', render: fmtDateTime },
          { title: tx('কারণ'), dataIndex: 'reason' },
          {
            title: '',
            render: (_, f) =>
              can('farmer.delete') ? (
                <Popconfirm title={tx('এই কৃষককে পুনরুদ্ধার করবেন?')} onConfirm={() => restore(f)}>
                  <Button size="small">{tx('পুনরুদ্ধার')}</Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />
      <p style={{ color: '#888' }}>
        {tx('সক্রিয় কৃষকের তালিকা:')} <Link to="/farmers">{tx('কৃষক তালিকা')}</Link>
      </p>
    </>
  )
}
