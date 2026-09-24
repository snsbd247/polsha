import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { toOptions } from '../../lib/funds'
import { LOAN_STATUS_COLOR, useLoanMeta, useLoanProducts, type LoanRow } from '../../lib/loans'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'

type Resp = Paginated<LoanRow> & { totals: { loans: number; disbursed: number } }
type Params = { page: number; per_page: number; search?: string; status?: string; product_id?: number; from?: string; to?: string }

/** Loan history: every application and loan, with what is still owed. */
export default function LoanListPage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const navigate = useNavigate()
  const meta = useLoanMeta()
  const products = useLoanProducts()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 25 })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const { data, isFetching } = useQuery({
    queryKey: ['loans', params],
    queryFn: async () => (await api.get<Resp>('/loans', { params })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('ঋণের তালিকা')}</h2>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/loans', { ...params, page: undefined, export: 'csv' }, 'loans.csv').catch((e) => message.error(errorMessage(e)))}>
            Excel
          </Button>
          {can('loan.create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/loans/new')}>
              {tx('ঋণের আবেদন')}
            </Button>
          )}
        </Space>
      </div>
      <div className="toolbar">
        <Input.Search placeholder={tx('ঋণ নং, নাম, সদস্য নং বা মোবাইল')} allowClear style={{ width: 260 }} onSearch={(search) => set({ search })} />
        <Select placeholder={tx('অবস্থা')} allowClear style={{ width: 190 }} options={toOptions(meta.data?.statuses)} onChange={(status) => set({ status })} />
        <Select
          placeholder={tx('ঋণের ধরন')}
          allowClear
          style={{ width: 200 }}
          options={(products.data ?? []).map((p) => ({ value: p.id, label: nameOf(p) }))}
          onChange={(product_id) => set({ product_id })}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          onChange={(r) => set({ from: (r?.[0] as Dayjs | null)?.format('YYYY-MM-DD'), to: (r?.[1] as Dayjs | null)?.format('YYYY-MM-DD') })}
        />
      </div>
      <Table<LoanRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1100 }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি; বিতরণ ৳{{p1}}', { p0: digits(t), p1: money(data?.totals.disbursed) }),
          onChange: (page, per_page) => setParams((p) => ({ ...p, page, per_page })),
        }}
        columns={[
          { title: tx('ঋণ নং'), dataIndex: 'loan_no', width: 140, render: (v: string, r) => <Link to={`/loans/${r.id}`}>{digits(v)}</Link> },
          {
            title: tx('সদস্য'),
            render: (_, r) => (
              <>
                {nameOf(r.member?.farmer)} <span style={{ color: '#888' }}>({digits(r.member?.member_no)})</span>
              </>
            ),
          },
          { title: tx('ঋণের ধরন'), render: (_, r) => nameOf(r.product) },
          { title: tx('আবেদন'), dataIndex: 'applied_on', width: 110, render: fmtDate },
          { title: tx('বিতরণ'), dataIndex: 'disbursed_on', width: 110, render: fmtDate },
          { title: tx('ঋণের পরিমাণ'), dataIndex: 'amount', width: 130, align: 'right', render: money },
          { title: tx('আসল বাকি'), dataIndex: 'principal_outstanding', width: 130, align: 'right', render: (v) => (v === null || v === undefined ? '' : money(v)) },
          { title: tx('অবস্থা'), dataIndex: 'status', width: 170, render: (s: string) => <Tag color={LOAN_STATUS_COLOR[s]}>{meta.data?.statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}
