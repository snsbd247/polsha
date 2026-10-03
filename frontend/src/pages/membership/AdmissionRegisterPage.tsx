import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, DatePicker, Space, Table, Tag } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { Can } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { usePublicSettings } from '../../lib/settings'
import { t as tx } from '../../lib/i18n'
import PageTabs from '../../components/PageTabs'

type Row = {
  id: number
  farmer_id: number
  member_no: number
  name: string
  father_name: string
  address: string
  admitted_on: string
  admission_fee: string | null
  initial_shares: number | null
  nominees: string
  resolution_no: string | null
  is_legacy: boolean
  status: string
  cancelled_on: string | null
  cancel_reason: string | null
}

export default function AdmissionRegisterPage() {
  const { message } = App.useApp()
  const { data: settings } = usePublicSettings()
  const [range, setRange] = useState<{ from?: string; to?: string }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)

  const { data, isFetching } = useQuery({
    queryKey: ['admission-register', range, page, perPage],
    queryFn: async () => (await api.get<Paginated<Row>>('/members/admission-register', { params: { ...range, page, per_page: perPage } })).data,
    placeholderData: keepPreviousData,
  })
  const offset = ((data?.current_page ?? 1) - 1) * (data?.per_page ?? perPage)

  return (
    <>
      <div className="page-header no-print">
        <h2>{tx('ভর্তি রেজিস্টার')}</h2>
        <Space wrap>
          <DatePicker.RangePicker
            format="DD/MM/YYYY"
            onChange={(r: [Dayjs | null, Dayjs | null] | null) => {
              setRange({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })
              setPage(1)
            }}
          />
          <Can perm="member.export">
            <Button icon={<DownloadOutlined />} onClick={() => downloadExport('/members/admission-register/export', range, 'admission-register.csv').catch((e) => message.error(errorMessage(e)))}>
              Excel
            </Button>
          </Can>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            {tx('প্রিন্ট / PDF')}
          </Button>
        </Space>
      </div>
      <PageTabs />
      <div className="print-only" style={{ textAlign: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{settings?.society_name_bn}</h2>
        <div>
          {tx('সদস্য ভর্তি রেজিস্টার')} {range.from && `(${fmtDate(range.from)} — ${fmtDate(range.to)})`}
        </div>
      </div>
      <Table<Row>
        rowKey="id"
        size="small"
        bordered
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize: perPage,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [50, 100],
          onChange: (p, s) => {
            setPage(p)
            setPerPage(s)
          },
        }}
        columns={[
          { title: tx('ক্রমিক'), width: 60, render: (_, __, i) => digits(offset + i + 1) },
          { title: tx('সদস্য নং'), dataIndex: 'member_no', render: digits },
          { title: tx('নাম'), dataIndex: 'name', render: (v, r) => <Link to={`/farmers/${r.farmer_id}`}>{v}</Link> },
          { title: tx('পিতা'), dataIndex: 'father_name' },
          { title: tx('ঠিকানা'), dataIndex: 'address' },
          {
            title: tx('ভর্তির তারিখ'),
            dataIndex: 'admitted_on',
            render: (v, r) => (
              <>
                {fmtDate(v)}
                {r.is_legacy && <Tag style={{ marginInlineStart: 4 }}>{tx('পুরোনো')}</Tag>}
              </>
            ),
          },
          { title: tx('ভর্তি ফি'), dataIndex: 'admission_fee', render: (v) => (v ? tx('৳ {{p0}}', { p0: digits(Number(v)) }) : '—') },
          { title: tx('প্রাথমিক শেয়ার'), dataIndex: 'initial_shares', render: (v) => (v ? digits(v) : '—') },
          { title: tx('নমিনি'), dataIndex: 'nominees' },
          { title: tx('সভার সিদ্ধান্ত'), dataIndex: 'resolution_no', render: (v) => v ?? '—' },
          { title: tx('বাতিল'), render: (_, r) => (r.cancelled_on ? `${fmtDate(r.cancelled_on)} — ${r.cancel_reason ?? ''}` : '—') },
        ]}
      />
    </>
  )
}
