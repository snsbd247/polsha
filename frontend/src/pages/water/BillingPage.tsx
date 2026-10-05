import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { Alert, App, Button, Checkbox, ConfigProvider, DatePicker, Dropdown, Form, Input, Modal, Pagination, Select, Table, type TableColumnsType } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  DownloadOutlined,
  DownOutlined,
  EyeOutlined,
  FileTextFilled,
  FilterFilled,
  GiftOutlined,
  HomeOutlined,
  HourglassOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { billLabel, monthLabel, useWaterMeta, type WaterBill } from '../../lib/water'
import './connections.css'

/**
 * Water → monthly bills, as the approved design: one month's bills with
 * summary cards, filters and the list; "Generate Monthly Bills" makes the
 * month's bills for every billable connection in one go.
 */
type Bill = WaterBill & { farmer_code?: string | null }
type Cards = { total: number; paid: number; pending: number; overdue: number; amount: number }
type Params = { page: number; per_page: number; period: string; status?: string; village_id?: number; search?: string }
type PreviewRow = { id: number; connection_no: string; name_bn: string; name_en: string | null; type: string | null; type_en: string | null; fee: number }
type Preview = { period: string; count: number; total: number; already_billed: number; rows: PreviewRow[]; no_fee: PreviewRow[] }
type GenValues = { period: Dayjs; bill_date: Dayjs; due_date?: Dayjs }

const COLS_KEY = 'polsha.water.bills.hidden'
const thisMonth = () => dayjs().format('YYYY-MM')
/** "2026-10" → "Oct 2026" (short, as in the design's list) */
const shortMonth = (period?: string | null) => (period ? digits(dayjs(`${period}-01`).format('MMM YYYY')) : '—')
const longDate = (d?: string | null) => (d ? digits(dayjs(d).format('DD MMM YYYY')) : '—')
const pct = (part: number, whole: number) => `${digits(whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0')}%`
const isOverdue = (b: Bill) => (b.status === 'unpaid' || b.status === 'partial') && !!b.due_date && dayjs(b.due_date).isBefore(dayjs(), 'day')

function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export default function BillingPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10, period: thisMonth() })
  const [draft, setDraft] = useState<Omit<Params, 'page' | 'per_page'>>({ period: thisMonth() })
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>(readHidden)
  const [printing, setPrinting] = useState(false)
  const [viewing, setViewing] = useState<Bill | null>(null)
  const [cancelling, setCancelling] = useState<Bill | null>(null)
  const [waiving, setWaiving] = useState<Bill | null>(null)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reasonForm] = Form.useForm<{ reason: string }>()
  const [genForm] = Form.useForm<GenValues>()
  const genPeriod = Form.useWatch('period', genForm)?.format('YYYY-MM')
  const { data: meta } = useWaterMeta()
  const villages = useQuery({ queryKey: ['villages', 'all'], queryFn: async () => (await api.get<LocationItem[]>('/locations/villages', { params: { active_only: 1 } })).data })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'bills', 'monthly', params],
    queryFn: async () => (await api.get<Paginated<Bill> & { cards: Cards }>('/water/bills', { params: { ...params, kind: 'monthly' } })).data,
    placeholderData: keepPreviousData,
  })
  const preview = useQuery({
    queryKey: ['water', 'billing-preview', genPeriod],
    queryFn: async () => (await api.get<Preview>('/water/billing/preview', { params: { period: genPeriod } })).data,
    enabled: generating && !!genPeriod,
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(hidden))
    } catch {
      /* storage unavailable */
    }
  }, [hidden])
  useEffect(() => {
    if (!printing) return
    const id = window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
    return () => window.clearTimeout(id)
  }, [printing])

  const apply = () => setParams((p) => ({ ...p, ...draft, search: draft.search?.trim() || undefined, page: 1 }))
  const reset = () => {
    setDraft({ period: thisMonth() })
    setParams((p) => ({ page: 1, per_page: p.per_page, period: thisMonth() }))
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['water'] })

  const cards = data?.cards
  const month = monthLabel(params.period)
  const cardList: { key: string; icon: ReactNode; label: string; value: string; sub: string }[] = [
    { key: 'blue', icon: <FileTextFilled />, label: tx('বিলের সংখ্যা'), value: digits((cards?.total ?? 0).toLocaleString('en-IN')), sub: tx('এই মাস ({{p0}})', { p0: shortMonth(params.period) }) },
    { key: 'green', icon: <CheckCircleOutlined />, label: tx('পরিশোধিত বিল'), value: digits((cards?.paid ?? 0).toLocaleString('en-IN')), sub: tx('মোটের {{p0}}', { p0: pct(cards?.paid ?? 0, cards?.total ?? 0) }) },
    { key: 'red', icon: <HourglassOutlined />, label: tx('অপেক্ষমাণ বিল'), value: digits((cards?.pending ?? 0).toLocaleString('en-IN')), sub: tx('মোটের {{p0}}', { p0: pct(cards?.pending ?? 0, cards?.total ?? 0) }) },
    { key: 'orange', icon: <StopOutlined />, label: tx('মেয়াদোত্তীর্ণ বিল'), value: digits((cards?.overdue ?? 0).toLocaleString('en-IN')), sub: tx('মোটের {{p0}}', { p0: pct(cards?.overdue ?? 0, cards?.total ?? 0) }) },
    { key: 'purple', icon: <span className="wcl-taka">৳</span>, label: tx('মোট টাকা'), value: `৳ ${digits(Math.round(cards?.amount ?? 0).toLocaleString('en-IN'))}`, sub: tx('এই মাস') },
  ]

  const statusTag = (b: Bill) => {
    if (b.status === 'paid') return <span className="wcl-tag wcl-tag-green">{meta?.bill_statuses.paid ?? tx('পরিশোধিত')}</span>
    if (b.status === 'cancelled') return <span className="wcl-tag wcl-tag-grey">{meta?.bill_statuses.cancelled ?? tx('বাতিল')}</span>
    if (isOverdue(b)) return <span className="wcl-tag wcl-tag-red">{tx('মেয়াদোত্তীর্ণ')}</span>
    return <span className="wcl-tag wcl-tag-amber">{b.status === 'partial' ? (meta?.bill_statuses.partial ?? tx('আংশিক')) : tx('অপেক্ষমাণ')}</span>
  }

  const exportCsv = () =>
    downloadExport(
      '/water/bills',
      { ...params, kind: 'monthly', page: undefined, per_page: undefined, ids: selected.length ? selected.join(',') : undefined, export: 'csv' },
      `water-bills-${params.period}.csv`,
    ).catch((e) => message.error(errorMessage(e)))

  const allColumns: (TableColumnsType<Bill>[number] & { key: string; fixedCol?: boolean })[] = [
    { key: 'sl', title: '#', width: 48, fixedCol: true, render: (_, __, i) => digits((params.page - 1) * params.per_page + i + 1) },
    { key: 'bill_no', title: tx('বিল নং'), dataIndex: 'bill_no', width: 150, fixedCol: true, render: (v: string) => digits(v) },
    { key: 'customer_id', title: tx('গ্রাহক আইডি'), width: 92, render: (_, b) => (b.farmer_code ? digits(b.farmer_code) : <span className="wcl-muted">—</span>) },
    {
      key: 'name',
      title: tx('গ্রাহকের নাম'),
      width: 145,
      render: (_, b) => (
        <Link to={`/water/connections/${b.connection_id}`} className="wcl-plain-link" title={nameOf(b.snapshot)}>
          {nameOf(b.snapshot)}
        </Link>
      ),
    },
    { key: 'connection_no', title: tx('সংযোগ নং'), width: 106, render: (_, b) => digits(b.snapshot.connection_no) },
    {
      key: 'area',
      title: tx('এলাকা / গ্রাম'),
      width: 127,
      render: (_, b) => {
        const area = [b.snapshot.address, nameOf({ name_bn: b.snapshot.village, name_en: b.snapshot.village_en })].filter(Boolean).join(', ')
        return area ? <span title={area}>{area}</span> : <span className="wcl-muted">—</span>
      },
    },
    { key: 'month', title: tx('বিলের মাস'), width: 90, render: (_, b) => shortMonth(b.period) },
    { key: 'amount', title: tx('টাকা (৳)'), width: 88, align: 'right', render: (_, b) => money(Number(b.amount) + Number(b.penalty)) },
    { key: 'due_date', title: tx('শেষ তারিখ'), dataIndex: 'due_date', width: 104, render: longDate },
    { key: 'status', title: tx('অবস্থা'), width: 100, render: (_, b) => statusTag(b) },
    {
      key: 'action',
      title: tx('কাজ'),
      width: 132,
      fixedCol: true,
      className: 'wcl-no-print wcl-actcol',
      render: (_, b) => {
        const canCollect = can('water.create') && b.due > 0
        return (
          <span className="wcl-acts">
            <button type="button" className="wcl-act" aria-label={tx('বিস্তারিত')} title={tx('বিস্তারিত')} onClick={() => setViewing(b)}>
              <EyeOutlined />
            </button>
            <button
              type="button"
              className="wcl-act wcl-act-edit"
              aria-label={tx('টাকা আদায়')}
              title={canCollect ? tx('টাকা আদায়') : tx('আদায়ের কিছু নেই')}
              disabled={!canCollect}
              onClick={() => navigate(`/water/collect?connection=${b.connection_id}`)}
            >
              <DollarOutlined />
            </button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  { key: 'view', icon: <EyeOutlined />, label: tx('বিলের বিস্তারিত'), onClick: () => setViewing(b) },
                  { key: 'connection', icon: <FileTextFilled />, label: tx('সংযোগের পাতা'), onClick: () => navigate(`/water/connections/${b.connection_id}`) },
                  ...(can('water.approve') && b.penalty > 0 && b.due > 0
                    ? [{ key: 'waive', icon: <GiftOutlined />, label: tx('জরিমানা মওকুফ'), onClick: () => (reasonForm.resetFields(), setWaiving(b)) }]
                    : []),
                  ...(can('water.edit') && b.status === 'unpaid' && b.paid_amount === 0
                    ? [{ key: 'cancel', icon: <CloseCircleOutlined />, danger: true, label: tx('বাতিলের অনুরোধ'), onClick: () => (reasonForm.resetFields(), setCancelling(b)) }]
                    : []),
                ],
              }}
            >
              <button type="button" className="wcl-act" aria-label={tx('আরও')}>
                <MoreOutlined />
              </button>
            </Dropdown>
          </span>
        )
      },
    },
  ]
  const hideable = allColumns.filter((c) => !c.fixedCol)
  const columns = allColumns.filter((c) => !hidden.includes(c.key))
  const rows = useMemo(() => {
    const all = data?.data ?? []
    return printing && selected.length ? all.filter((r) => selected.includes(r.id)) : all
  }, [data, printing, selected])
  const total = data?.total ?? 0
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)

  const sendReason = async ({ reason }: { reason: string }) => {
    setBusy(true)
    try {
      if (cancelling) {
        await api.post(`/water/bills/${cancelling.id}/cancel`, { reason })
        message.success(tx('বাতিলের অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'))
      } else if (waiving) {
        await api.post(`/water/bills/${waiving.id}/waive-penalty`, { reason })
        message.success(tx('জরিমানা মওকুফ হয়েছে।'))
      }
      setCancelling(null)
      setWaiving(null)
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const openGenerate = () => {
    genForm.resetFields()
    genForm.setFieldsValue({ period: dayjs(`${params.period}-01`), bill_date: dayjs() })
    setGenerating(true)
  }
  const generate = async (v: GenValues) => {
    setBusy(true)
    try {
      const r = await api.post<{ count: number; total: number }>('/water/billing', {
        period: v.period.format('YYYY-MM'),
        bill_date: v.bill_date.format('YYYY-MM-DD'),
        due_date: v.due_date?.format('YYYY-MM-DD'),
      })
      message.success(tx('{{p0}}টি বিল তৈরি হয়েছে — মোট ৳{{p1}}', { p0: digits(r.data.count), p1: money(r.data.total) }))
      setGenerating(false)
      const period = v.period.format('YYYY-MM')
      setDraft((d) => ({ ...d, period }))
      setParams((p) => ({ ...p, period, page: 1 }))
      refresh()
    } catch (e) {
      if (!applyFormErrors(genForm, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const pv = preview.data

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0', borderRadius: 6 } }}>
      <div className="wcl wcl-bills">
        <nav className="wcl-crumb wcl-no-print">
          <Link to="/">
            <HomeOutlined /> {tx('হোম')}
          </Link>
          <RightOutlined className="wcl-sep" />
          <span>{tx('পানি সরবরাহ')}</span>
          <RightOutlined className="wcl-sep" />
          <b>{tx('মাসিক বিল')}</b>
        </nav>

        <div className="wcl-cards wcl-no-print">
          {cardList.map((c) => (
            <div key={c.key} className={`wcl-card wcl-card-${c.key} wcl-card-labelled`}>
              <span className="wcl-card-ic">{c.icon}</span>
              <span className="wcl-card-body">
                <span className="wcl-card-label">{c.label}</span>
                <b>{c.value}</b>
                <small>{c.sub}</small>
              </span>
            </div>
          ))}
        </div>

        <div className="wcl-filters wcl-filters-titled wcl-no-print">
          <h3 className="wcl-filter-title">
            <FilterFilled /> {tx('ফিল্টার ও খোঁজ')}
          </h3>
          <label className="wcl-field wcl-field-search">
            <span>{tx('খুঁজুন')}</span>
            <Input
              prefix={<SearchOutlined />}
              placeholder={tx('গ্রাহকের নাম, সংযোগ নং, বিল নং, মোবাইল...')}
              allowClear
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
              onPressEnter={apply}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('বিলের মাস')}</span>
            <DatePicker
              picker="month"
              allowClear={false}
              value={dayjs(`${draft.period}-01`)}
              format={(d) => monthLabel(d.format('YYYY-MM'))}
              onChange={(d) => d && setDraft((x) => ({ ...x, period: d.format('YYYY-MM') }))}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('পরিশোধের অবস্থা')}</span>
            <Select
              value={draft.status ?? ''}
              options={[
                { value: '', label: tx('সব অবস্থা') },
                { value: 'paid', label: tx('পরিশোধিত') },
                { value: 'pending', label: tx('অপেক্ষমাণ') },
                { value: 'overdue', label: tx('মেয়াদোত্তীর্ণ') },
                { value: 'partial', label: meta?.bill_statuses.partial ?? tx('আংশিক') },
                { value: 'cancelled', label: meta?.bill_statuses.cancelled ?? tx('বাতিল') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </label>
          <label className="wcl-field">
            <span>{tx('এলাকা / গ্রাম')}</span>
            <Select
              value={draft.village_id ?? 0}
              showSearch={{ optionFilterProp: 'label' }}
              options={[{ value: 0, label: tx('সব এলাকা') }, ...(villages.data ?? []).map((v) => ({ value: v.id, label: nameOf(v) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, village_id: v || undefined }))}
            />
          </label>
          <div className="wcl-filter-btns">
            <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
              {tx('খুঁজুন')}
            </Button>
            <Button className="wcl-reset" onClick={reset}>
              {tx('রিসেট')}
            </Button>
          </div>
        </div>

        <div className="wcl-list">
          <div className="wcl-tools">
            <h3 className="wcl-list-title">
              <FileTextFilled /> {tx('মাসিক বিলের তালিকা')} <small className="wcl-print-only">— {month}</small>
            </h3>
            <span className="wcl-tools-gap" />
            {selected.length > 0 && <span className="wcl-picked wcl-no-print">{tx('{{p0}}টি বাছাই করা', { p0: digits(selected.length) })}</span>}
            {can('water.create') && (
              <Button type="primary" icon={<PlusOutlined />} className="wcl-no-print" onClick={openGenerate}>
                {tx('মাসিক বিল তৈরি করুন')}
              </Button>
            )}
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{ items: [{ key: 'csv', icon: <DownloadOutlined />, label: selected.length ? tx('বাছাই করা সারি — CSV (Excel)') : tx('সব সারি — CSV (Excel)'), onClick: exportCsv }] }}
            >
              <Button icon={<DownloadOutlined />} className="wcl-no-print">
                {tx('এক্সপোর্ট')} <DownOutlined className="wcl-caret" />
              </Button>
            </Dropdown>
            <Button icon={<PrinterOutlined />} className="wcl-no-print" onClick={() => setPrinting(true)}>
              {tx('প্রিন্ট')}
            </Button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              popupRender={() => (
                <div className="wcl-colmenu">
                  {hideable.map((c) => (
                    <Checkbox key={c.key} checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                      {c.title as string}
                    </Checkbox>
                  ))}
                </div>
              )}
            >
              <Button icon={<SettingOutlined />} className="wcl-no-print">
                {tx('কলাম সেটিংস')}
              </Button>
            </Dropdown>
          </div>

          <Table<Bill>
            className="wcl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            tableLayout="fixed"
            scroll={{ x: 1180 }}
            pagination={false}
            locale={{ emptyText: tx('এই মাসের কোনো বিল নেই — "মাসিক বিল তৈরি করুন" চাপুন') }}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 44, preserveSelectedRowKeys: true }}
            columns={columns}
          />

          <div className="wcl-foot wcl-no-print">
            <span>{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি রেকর্ড', { p0: digits(from), p1: digits(to), p2: digits(total.toLocaleString('en-IN')) })}</span>
            <span className="wcl-foot-end">
              <Pagination
                className="wcl-pager"
                current={params.page}
                pageSize={params.per_page}
                total={total}
                showSizeChanger={false}
                showLessItems
                itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
                onChange={(page) => setParams((p) => ({ ...p, page }))}
              />
              <Select
                className="wcl-size"
                value={params.per_page}
                options={[10, 25, 50, 100].map((n) => ({ value: n, label: tx('{{p0}} / পাতা', { p0: digits(n) }) }))}
                onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))}
              />
            </span>
          </div>
        </div>

        {/* make a month's bills */}
        <Modal
          open={generating}
          width={720}
          title={tx('মাসিক বিল তৈরি')}
          onCancel={() => setGenerating(false)}
          onOk={() => genForm.submit()}
          okText={pv ? tx('{{p0}}টি বিল তৈরি করুন', { p0: digits(pv.count) }) : tx('বিল তৈরি করুন')}
          okButtonProps={{ disabled: !pv?.count }}
          confirmLoading={busy}
          destroyOnHidden
        >
          <p className="wcl-modal-note">{tx('চালু সব সংযোগের বিল একসাথে তৈরি হয় ও সাথে সাথে হিসাবের খাতায় ওঠে; ভুল হলে বিল বাতিলের অনুরোধ করতে হয়।')}</p>
          <Form form={genForm} layout="vertical" onFinish={generate}>
            <div className="wcl-gen-fields">
              <Form.Item name="period" label={tx('কোন মাসের বিল')} rules={[{ required: true }]}>
                <DatePicker picker="month" format={(d) => monthLabel(d.format('YYYY-MM'))} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs().add(1, 'month'), 'month')} />
              </Form.Item>
              <Form.Item name="bill_date" label={tx('বিলের তারিখ')} rules={[{ required: true }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
              <Form.Item name="due_date" label={tx('পরিশোধের শেষ তারিখ (ঐচ্ছিক)')}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Form>
          {preview.isFetching && !pv && <p className="wcl-muted">{tx('হিসাব হচ্ছে…')}</p>}
          {pv && (
            <>
              <div className="wcl-gen-stats">
                <div>
                  <small>{tx('বিল হবে')}</small>
                  <b>{tx('{{p0}}টি সংযোগ', { p0: digits(pv.count) })}</b>
                </div>
                <div>
                  <small>{tx('মোট টাকা')}</small>
                  <b>৳ {money(pv.total)}</b>
                </div>
                <div>
                  <small>{tx('এই মাসের বিল আগেই হয়েছে')}</small>
                  <b>{tx('{{p0}}টি', { p0: digits(pv.already_billed) })}</b>
                </div>
              </div>
              {pv.no_fee.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={tx('{{p0}}টি সংযোগের মাসিক ফি ঠিক করা নেই — এগুলোর বিল হবে না।', { p0: digits(pv.no_fee.length) })}
                  description={
                    <>
                      {pv.no_fee.map((r) => `${digits(r.connection_no)} ${nameOf(r)}`).join(', ')} — <Link to="/water/types">{tx('সংযোগের ধরন ও ফি ঠিক করুন')}</Link>
                    </>
                  }
                />
              )}
              {pv.rows.length > 0 && (
                <Table<PreviewRow>
                  rowKey="id"
                  size="small"
                  dataSource={pv.rows}
                  pagination={{ pageSize: 8, hideOnSinglePage: true, size: 'small' }}
                  columns={[
                    { title: tx('সংযোগ নং'), dataIndex: 'connection_no', width: 120, render: (v: string) => digits(v) },
                    { title: tx('গ্রাহক'), render: (_, r) => nameOf(r) },
                    { title: tx('ধরন'), render: (_, r) => nameOf({ name_bn: r.type, name_en: r.type_en }) },
                    { title: tx('বিল'), dataIndex: 'fee', width: 100, align: 'right', render: money },
                  ]}
                />
              )}
            </>
          )}
        </Modal>

        <Modal open={!!viewing} title={viewing ? `${tx('বিল')} ${digits(viewing.bill_no)}` : ''} footer={null} onCancel={() => setViewing(null)} destroyOnHidden>
          {viewing && (
            <dl className="wcl-kv">
              {(
                [
                  [tx('গ্রাহক'), nameOf(viewing.snapshot)],
                  [tx('সংযোগ নং'), digits(viewing.snapshot.connection_no)],
                  [tx('কিসের বিল'), billLabel(viewing)],
                  [tx('বিলের তারিখ'), longDate(viewing.bill_date)],
                  [tx('শেষ তারিখ'), longDate(viewing.due_date)],
                  [tx('বিল'), `৳ ${money(viewing.amount)}`],
                  [tx('জরিমানা'), `৳ ${money(viewing.penalty)}`],
                  [tx('আদায়'), `৳ ${money(viewing.paid_amount)}`],
                  [tx('বকেয়া'), `৳ ${money(viewing.due)}`],
                  [tx('অবস্থা'), statusTag(viewing)],
                ] as [string, ReactNode][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Modal>

        <Modal
          open={!!cancelling || !!waiving}
          title={cancelling ? tx('বিল বাতিলের অনুরোধ — {{p0}}', { p0: digits(cancelling.bill_no) }) : tx('জরিমানা মওকুফ — {{p0}}', { p0: digits(waiving?.bill_no ?? '') })}
          onCancel={() => {
            setCancelling(null)
            setWaiving(null)
          }}
          onOk={() => reasonForm.submit()}
          confirmLoading={busy}
          okText={cancelling ? tx('অনুমোদনের জন্য পাঠান') : tx('মওকুফ করুন')}
          destroyOnHidden
        >
          <p className="wcl-modal-note">
            {cancelling
              ? tx('ম্যানেজার অনুমোদন দিলে বিল বাতিল হবে ও হিসাবের খাতায় উল্টো এন্ট্রি হবে।')
              : tx('এই বিলে অপরিশোধিত জরিমানা ৳{{p0}} মওকুফ হবে; আগে আদায় হওয়া টাকা বদলাবে না।', { p0: money(Math.min(waiving?.penalty ?? 0, waiving?.due ?? 0)) })}
          </p>
          <Form form={reasonForm} layout="vertical" onFinish={sendReason}>
            <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
              <Input.TextArea rows={2} maxLength={300} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  )
}
