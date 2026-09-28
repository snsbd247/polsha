import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Dropdown, Grid, Input, Modal, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AppstoreFilled, CheckOutlined, ClockCircleOutlined, CloseOutlined, DeleteFilled, DownOutlined, EditFilled, EyeFilled, PlusOutlined, PrinterOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import './farmer-merge-list.css'

type Side = { id: number; farmer_code: string; name_bn: string; name_en: string | null; nid: string | null; member_no: number | null; photo_url: string | null }
type Row = {
  id: number
  request_no: string
  status: 'pending' | 'approved' | 'rejected' | 'returned'
  created_at: string
  requester: { id: number; name_bn: string; name_en: string | null; role: string | null } | null
  reason: string | null
  reason_note: string | null
  keep: Side | null
  remove: Side | null
  can_change: boolean
}
type Summary = { total: number; merged: number; pending: number; rejected: number }
type Meta = { reasons: Record<string, string>; requesters: { id: number; name_bn: string; name_en: string | null }[] }
type Filters = { search?: string; status?: string; requested_by?: number; from?: string; to?: string }

const STATUS: Record<Row['status'], [string, string]> = {
  approved: [tx('মার্জ সম্পন্ন'), 'fl-tag-green'],
  pending: [tx('অপেক্ষমাণ'), 'fl-tag-gold'],
  rejected: [tx('প্রত্যাখ্যাত'), 'fl-tag-red'],
  returned: [tx('ফেরত'), 'll-orange'],
}

function Person({ f }: { f: Side | null }) {
  if (!f) return <>—</>
  return (
    <span className="mg-who">
      {f.photo_url ? <ProtectedImage url={f.photo_url} size={34} shape="square" /> : <span className="ml-initials mg-initials">{initials(nameOf(f))}</span>}
      <span className="mg-who-text">
        <Link to={`/farmers/${f.id}`} className="mg-name">
          {nameOf(f)}
        </Link>
        <small>
          {f.farmer_code} | NID: {f.nid ? digits(f.nid) : '—'}
        </small>
      </span>
    </span>
  )
}

/** Every farmer merge request — waiting, merged and rejected — with search, filters and exports. */
export default function FarmerMergeListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const params = { page, per_page: perPage, ...filters }

  const { data, isFetching } = useQuery({
    queryKey: ['merge-history', 'list', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/farmers-merge/history', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['merge-history', 'summary'], queryFn: async () => (await api.get<Summary>('/farmers-merge/summary')).data })
  const meta = useQuery({ queryKey: ['merge-history', 'meta'], queryFn: async () => (await api.get<Meta>('/farmers-merge/meta')).data })

  const s = summary.data
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({})
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const exportCsv = () => downloadExport('/farmers-merge/history', { ...filters, export: 'csv' }, 'farmer-merges.csv').catch((e) => message.error(errorMessage(e)))
  const all = [{ value: '', label: tx('সকল') }]

  const edit = (r: Row) => navigate(`/farmers/merge/new?a=${r.keep?.id}&b=${r.remove?.id}&edit=${r.id}${r.reason ? `&reason=${r.reason}` : ''}`)
  const remove = (r: Row) =>
    Modal.confirm({
      title: tx('মার্জ অনুরোধ {{p0}} মুছে ফেলবেন?', { p0: r.request_no }),
      content: tx('অনুরোধটি অনুমোদনের তালিকা থেকেও সরে যাবে। কৃষকের রেকর্ডে কোনো পরিবর্তন হবে না।'),
      okText: tx('মুছে ফেলুন'),
      okButtonProps: { danger: true },
      cancelText: tx('বাতিল'),
      onOk: async () => {
        try {
          const res = await api.delete(`/farmers-merge/${r.id}`)
          message.success(res.data.message)
          queryClient.invalidateQueries({ queryKey: ['merge-history'] })
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const cards = [
    { key: 'total', label: tx('মোট মার্জ অনুরোধ'), value: s?.total, icon: 'users', color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'merged', label: tx('মার্জ সম্পন্ন রেকর্ড'), value: s?.merged, icon: '', solid: <CheckOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'approved' }) },
    { key: 'pending', label: tx('অপেক্ষমাণ অনুরোধ'), value: s?.pending, icon: '', solid: <ClockCircleOutlined />, color: '#f5a524', tint: '#fdefd6', onClick: () => show({ status: 'pending,returned' }) },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত অনুরোধ'), value: s?.rejected, icon: '', solid: <CloseOutlined />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'rejected' }) },
  ]

  const allColumns: (ColumnsType<Row>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'no', title: tx('অনুরোধ নং'), dataIndex: 'request_no', render: (v: string) => digits(v) },
    { key: 'keep', title: tx('কৃষক ১ (রাখা হবে)'), render: (_, r) => <Person f={r.keep} /> },
    { key: 'arrow', title: '', width: 24, align: 'center', className: 'mg-arrow-cell', render: () => <SwapOutlined className="mg-arrow" /> },
    { key: 'remove', title: tx('কৃষক ২ (মার্জ হবে)'), render: (_, r) => <Person f={r.remove} /> },
    {
      key: 'reason',
      title: tx('কারণ'),
      className: 'mg-wrap',
      render: (_, r) => {
        const label = r.reason ? (meta.data?.reasons[r.reason] ?? r.reason) : '—'
        return r.reason_note ? <Tooltip title={r.reason_note}>{label}</Tooltip> : label
      },
    },
    {
      key: 'by',
      title: tx('অনুরোধকারী'),
      className: 'mg-wrap',
      render: (_, r) =>
        r.requester ? (
          <span className="mg-by">
            {nameOf(r.requester)}
            {r.requester.role && <small>({r.requester.role})</small>}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'date', title: tx('অনুরোধের তারিখ'), dataIndex: 'created_at', render: fmtDate },
    { key: 'status', title: tx('অবস্থা'), dataIndex: 'status', render: (st: Row['status']) => <Tag className={`fl-tag mg-status ${STATUS[st]?.[1] ?? ''}`}>{STATUS[st]?.[0] ?? st}</Tag> },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 136,
      fixed: wide ? 'right' : undefined,
      render: (_, r) => (
        <div className="mg-actions">
          <Button type="text" className="mg-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/approvals/${r.id}`)} />
          {r.can_change && can('farmer.edit') && (
            <>
              <Button className="mg-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} onClick={() => edit(r)} />
              <Button className="mg-act mg-del" icon={<DeleteFilled />} aria-label={tx('মুছুন')} onClick={() => remove(r)} />
            </>
          )}
        </div>
      ),
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'arrow', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  return (
    <ListFrame
      section={{ label: tx('কৃষক ও সদস্য'), to: '/farmers' }}
      title={tx('কৃষক মার্জের তালিকা')}
      subtitle={tx('কৃষক মার্জ অনুরোধ দেখুন ও পরিচালনা করুন। ডুপ্লিকেট কৃষক রেকর্ড মিলিয়ে তথ্য পরিচ্ছন্ন ও নির্ভুল রাখুন।')}
      actions={
        can('farmer.edit') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/farmers/merge/new')}>
            {tx('নতুন মার্জ অনুরোধ')}
          </Button>
        )
      }
      cards={cards}
      filterClass="mg-filters"
      filters={
        <>
          <Field grow={330}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('নাম, সদস্য নং, NID বা অনুরোধ নং দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => set({ search: e.target.value || undefined })}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.status ?? ''} options={[...all, ...Object.entries(STATUS).map(([value, [label]]) => ({ value, label }))]} onChange={(v) => set({ status: v || undefined })} />
          </Field>
          <Field label={tx('অনুরোধকারী')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.requested_by ?? ''}
              options={[...all, ...(meta.data?.requesters ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
              onChange={(v) => set({ requested_by: v === '' ? undefined : Number(v) })}
            />
          </Field>
          <Field label={tx('তারিখ (থেকে)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.from ?? null} onChange={(d) => setRange((r) => ({ ...r, from: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('তারিখ (পর্যন্ত)')}>
            <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" value={range.to ?? null} onChange={(d) => setRange((r) => ({ ...r, to: d }))} style={{ width: '100%', height: 36 }} />
          </Field>
        </>
      }
      onSearch={apply}
      onReset={() => show({})}
      tableTitle={tx('কৃষক মার্জের তালিকা ({{p0}})', { p0: n0(total) })}
      tableTools={
        <>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'csv', label: 'Excel (CSV)', onClick: exportCsv },
                {
                  key: 'cols',
                  label: tx('কলাম'),
                  children: hideable.map((c) => ({
                    key: `col-${c.key}`,
                    label: (
                      <Checkbox checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                        {c.title as string}
                      </Checkbox>
                    ),
                  })),
                },
              ],
            }}
          >
            <Button icon={<AppstoreFilled />} className="ml-columns pl-columns">
              {tx('এক্সপোর্ট')} <DownOutlined className="fl-caret" />
            </Button>
          </Dropdown>
          <Button icon={<PrinterOutlined />} className="ml-columns pl-columns" onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
        </>
      }
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
      <Table<Row>
        className="fl-table ml-table pl-table mg-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
        columns={columns}
        locale={{ emptyText: tx('এখনো কোনো মার্জ অনুরোধ নেই') }}
      />
    </ListFrame>
  )
}
