import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DatePicker, Input, Modal, Select, Table, Tag, Button, Grid, Descriptions } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, CloudDownloadOutlined, EyeFilled, SearchOutlined, TeamOutlined, FileTextFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { ExportMenu, Field, initials, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'

type Person = { id: number; name_bn: string; name_en: string | null; username?: string }
type Row = { id: number; report_key: string; title: string; format: string; filters: Record<string, unknown> | null; row_count: number; ip: string | null; created_at: string; user: Person | null }
type Resp = Paginated<Row> & {
  counts: { total: number; today: number; month: number; users: number; rows: number }
  formats: Record<string, string>
  users: Person[]
}
type Filters = { search?: string; user_id?: number; format?: string; from?: string; to?: string }

const FORMAT_TONE: Record<string, string> = { xlsx: 'fl-tag-green', csv: 'll-blue', print: 'll-purple' }

/** Who exported or printed which list or report: every Excel, CSV and print is logged. */
export default function ExportAuditPage() {
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [range, setRange] = useState<{ from?: Dayjs | null; to?: Dayjs | null }>({})
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [view, setView] = useState<Row | null>(null)

  const params = { page, per_page: perPage, ...filters }
  const { data, isFetching } = useQuery({
    queryKey: ['export-logs', params],
    queryFn: async () => (await api.get<Resp>('/export-logs', { params })).data,
    placeholderData: keepPreviousData,
  })
  const c = data?.counts
  const total = data?.total ?? 0
  const from = total ? (page - 1) * perPage + 1 : 0
  const today = dayjs().format('YYYY-MM-DD')
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
    setRange({ from: f.from ? dayjs(f.from) : null, to: f.to ? dayjs(f.to) : null })
    setPage(1)
  }
  const apply = () => {
    setFilters({ ...draft, from: range.from?.format('YYYY-MM-DD'), to: range.to?.format('YYYY-MM-DD') })
    setPage(1)
  }
  const all = [{ value: '', label: tx('সকল') }]

  const cards = [
    { key: 'total', label: tx('মোট এক্সপোর্ট · {{p0}} সারি', { p0: n0(c?.rows ?? 0) }), value: c?.total, icon: '', glyph: <CloudDownloadOutlined />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    { key: 'today', label: tx('আজকের এক্সপোর্ট'), value: c?.today, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ from: today, to: today }) },
    {
      key: 'month',
      label: tx('এই মাসে'),
      value: c?.month,
      icon: '',
      glyph: <FileTextFilled />,
      color: '#1f9d55',
      tint: '#dcf3e5',
      onClick: () => show({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: today }),
    },
    { key: 'users', label: tx('এক্সপোর্টকারী ইউজার'), value: c?.users, icon: '', glyph: <TeamOutlined />, color: '#8b3fe0', tint: '#efe4fc' },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: tx('সময়'), dataIndex: 'created_at', render: (v: string) => fmtDateTime(v) },
    {
      title: tx('ইউজার'),
      render: (_, r) =>
        r.user ? (
          <span className="mg-who">
            <span className="ml-initials mg-initials">{initials(r.user.name_bn)}</span>
            <span className="hs-two">
              <span className="mg-name">{nameOf(r.user)}</span>
              {r.user.username && <span>{r.user.username}</span>}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    { title: tx('রিপোর্ট/তালিকা'), dataIndex: 'title', render: (v: string) => <span className="fl-link">{digits(v)}</span> },
    { title: tx('ফরম্যাট'), dataIndex: 'format', render: (v: string) => <Tag className={`fl-tag iv-status ${FORMAT_TONE[v] ?? 'll-gray'}`}>{data?.formats[v] ?? v}</Tag> },
    { title: tx('সারি'), dataIndex: 'row_count', align: 'right', render: (v: number) => n0(v) },
    { title: tx('IP'), dataIndex: 'ip', render: (v: string | null) => v || '—' },
    {
      title: tx('অ্যাকশন'),
      width: 70,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, r) => <Button className="fl-act pl-act" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => setView(r)} />,
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('ক্যাশ বই ও খতিয়ান'), to: '/cashbook/irrigation' }}
      title={tx('Export অডিট')}
      subtitle=""
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={280}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('রিপোর্টের নাম বা IP দিয়ে খুঁজুন...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={apply}
            />
          </Field>
          <Field label={tx('ইউজার')}>
            <Select
              showSearch={{ optionFilterProp: 'label' }}
              value={draft.user_id ?? 0}
              options={[{ value: 0, label: tx('সকল') }, ...(data?.users ?? []).map((u) => ({ value: u.id, label: nameOf(u) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, user_id: v || undefined }))}
            />
          </Field>
          <Field label={tx('ফরম্যাট')}>
            <Select value={draft.format ?? ''} options={[...all, ...Object.entries(data?.formats ?? {}).map(([value, label]) => ({ value, label }))]} onChange={(v) => setDraft((d) => ({ ...d, format: v || undefined }))} />
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
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('এক্সপোর্টের তালিকা'), p1: n0(total) })}
      tableTools={<ExportMenu reports={[{ key: 'export_logs', label: tx('Export অডিট') }]} filters={{ from: filters.from ?? dayjs().startOf('month').format('YYYY-MM-DD'), to: filters.to ?? today, user_id: filters.user_id }} />}
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
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={data?.data ?? []}
        scroll={{ x: 'max-content' }}
        pagination={false}
        columns={columns}
        locale={{ emptyText: tx('কোনো এক্সপোর্ট পাওয়া যায়নি') }}
      />
      <Modal open={!!view} title={view ? digits(view.title) : ''} footer={null} onCancel={() => setView(null)} width={640}>
        {view && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={tx('সময়')}>{fmtDateTime(view.created_at)}</Descriptions.Item>
            <Descriptions.Item label={tx('ইউজার')}>{view.user ? nameOf(view.user) : '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('ফরম্যাট')}>{data?.formats[view.format] ?? view.format}</Descriptions.Item>
            <Descriptions.Item label={tx('সারি')}>{n0(view.row_count)}</Descriptions.Item>
            <Descriptions.Item label={tx('রিপোর্ট কী')}>{view.report_key}</Descriptions.Item>
            <Descriptions.Item label={tx('IP')}>{view.ip || '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('ফিল্টার')}>
              {view.filters && Object.keys(view.filters).length
                ? Object.entries(view.filters)
                    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join(' · ')
                : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </ListFrame>
  )
}
