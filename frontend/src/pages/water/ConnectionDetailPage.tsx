import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { App, AutoComplete, Button, ConfigProvider, DatePicker, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Result, Spin, Table, Upload } from 'antd'
import {
  AimOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CalendarFilled,
  CameraOutlined,
  CreditCardFilled,
  DashboardFilled,
  DeleteOutlined,
  DisconnectOutlined,
  DollarOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EnvironmentFilled,
  EyeOutlined,
  FileAddFilled,
  FileTextFilled,
  FileTextOutlined,
  HomeOutlined,
  IdcardFilled,
  LinkOutlined,
  MobileFilled,
  PictureFilled,
  PrinterOutlined,
  RightOutlined,
  SendOutlined,
  StopOutlined,
  ThunderboltFilled,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import type { AuditLog } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { billLabel, monthLabel, useWaterMeta, type WaterBill, type WaterConnection } from '../../lib/water'
import AuditLogTable from '../../components/AuditLogTable'
import ConnectionForm from './ConnectionForm'
import './connection-detail.css'

/**
 * One water connection, laid out as the approved design: a header card with the
 * customer and the key numbers, then Overview / Billing & payments / Activity tabs.
 */
type Doc = { id: number; title: string; original_name: string; mime: string | null; size: number; created_at: string; uploader?: { name_bn: string; name_en: string | null } | null }
type Receipt = { id: number; receipt_no: string; date: string; amount: string; method: string; status: string }
type Detail = WaterConnection & {
  fee: number
  due: number
  bills: WaterBill[]
  receipts: Receipt[]
  documents: Doc[]
  creator: { name_bn: string; name_en: string | null } | null
}
type Action = 'disconnect' | 'reconnect' | 'close'
type Tab = 'overview' | 'billing' | 'activity'

const DOC_TITLES = ['NID কপি', 'আবেদন ফর্ম', 'চুক্তিপত্র', 'জমির দলিল', 'ছবি']

const initials = (name: string) =>
  name
    .replace(/^(মোঃ|মোছাঃ|মোসাঃ|মো\.|Md\.?|Mst\.?)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

const longDate = (d?: string | null) => (d ? digits(dayjs(d).format('DD MMM YYYY')) : '—')
const fileSize = (n: number) => digits(n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fileKind = (d: Doc) => (d.mime === 'application/pdf' || d.original_name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'JPG')

/** A file served from an authenticated route, as an object URL an <img> can show. */
function useBlobUrl(url: string | null) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    if (!url) return
    let objectUrl: string | undefined
    let cancelled = false
    api
      .get(url, { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(r.data)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(undefined))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  return url ? src : undefined
}

function Card({ icon, title, extra, children, className }: { icon: ReactNode; title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`wcd-card ${className ?? ''}`}>
      <header className="wcd-card-head">
        <h3>
          <span className="wcd-card-ic">{icon}</span>
          {title}
        </h3>
        {extra && <div className="wcd-card-extra">{extra}</div>}
      </header>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="wcd-rows">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function ConnectionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [docOpen, setDocOpen] = useState(false)
  const [bill, setBill] = useState<WaterBill | null>(null)
  const [actPage, setActPage] = useState(1)
  const [form] = Form.useForm()
  const [docForm] = Form.useForm()
  const { data: meta } = useWaterMeta()
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['water', 'connection', id],
    queryFn: async () => (await api.get<Detail>(`/water/connections/${id}`)).data,
  })
  const activity = useQuery({
    queryKey: ['water', 'connection', id, 'activity', actPage],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/water/connections/${id}/activity`, { params: { page: actPage } })).data,
    enabled: tab === 'activity',
  })
  const photoSrc = useBlobUrl(c?.photo ? `/water/connections/${c.id}/photo?v=${encodeURIComponent(c.photo)}` : null)

  if (isLoading) return <Spin />
  if (error || !c) return <Result status="404" title={errorMessage(error)} />

  const canEdit = can('water.edit')
  const name = nameOf(c)
  const area = [c.address, nameOf(c.village)].filter(Boolean).join(', ')
  const hasMap = c.latitude != null && c.longitude != null
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['water'] })

  const changeStatus = async (v: { date: dayjs.Dayjs; reason?: string; fee?: number }) => {
    setBusy(true)
    try {
      await api.post(`/water/connections/${c.id}/status`, { action, date: v.date.format('YYYY-MM-DD'), reason: v.reason, fee: v.fee })
      message.success(tx('সংযোগের অবস্থা বদলানো হয়েছে।'))
      setAction(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const openAction = (a: Action) => {
    form.resetFields()
    form.setFieldsValue({ date: dayjs(), fee: 0 })
    setAction(a)
  }
  const ACTION_TITLE: Record<Action, string> = {
    disconnect: tx('সংযোগ বিচ্ছিন্ন করুন'),
    reconnect: tx('আবার সংযোগ দিন'),
    close: tx('সংযোগ স্থায়ীভাবে বন্ধ করুন'),
  }

  const uploadPhoto = async (file: File) => {
    const body = new FormData()
    body.append('image', file)
    try {
      await api.post(`/water/connections/${c.id}/photo`, body)
      message.success(tx('ছবি সংরক্ষণ হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
    return false
  }
  const saveDoc = async (v: { title: string; file?: { originFileObj: File }[] }) => {
    const file = v.file?.[0]?.originFileObj
    if (!file) return
    setBusy(true)
    try {
      const body = new FormData()
      body.append('title', v.title)
      body.append('file', file)
      await api.post(`/water/connections/${c.id}/documents`, body)
      message.success(tx('ডকুমেন্ট আপলোড হয়েছে।'))
      setDocOpen(false)
      refresh()
    } catch (e) {
      if (!applyFormErrors(docForm, e)) message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const openDoc = async (d: Doc) => {
    try {
      const r = await api.get(`/water/connections/${c.id}/documents/${d.id}`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = d.original_name
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const deleteDoc = async (d: Doc) => {
    try {
      await api.delete(`/water/connections/${c.id}/documents/${d.id}`)
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const openDocForm = () => {
    docForm.resetFields()
    setDocOpen(true)
  }

  const statusTone = c.status === 'active' ? 'green' : c.status === 'disconnected' ? 'red' : 'amber'
  const statusPill = (
    <span className={`wcd-pill wcd-pill-${statusTone}`}>
      <i /> {meta?.statuses[c.status] ?? c.status}
    </span>
  )
  const customerId = c.farmer ? digits(c.farmer.farmer_code) : null
  const directions = hasMap
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([area, 'Bangladesh'].filter(Boolean).join(', '))}`
  const mapLink = hasMap ? `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}` : directions

  const billColumns = [
    { title: tx('বিলের মাস'), key: 'month', render: (_: unknown, b: WaterBill) => (b.kind === 'monthly' ? monthLabel(b.period) : billLabel(b)) },
    { title: tx('বিল নং'), dataIndex: 'bill_no', render: (v: string) => digits(v) },
    { title: tx('বিলের তারিখ'), dataIndex: 'bill_date', render: longDate },
    { title: tx('টাকা (৳)'), key: 'amount', align: 'right' as const, render: (_: unknown, b: WaterBill) => money(Number(b.amount) + Number(b.penalty)) },
    { title: tx('শেষ তারিখ'), dataIndex: 'due_date', render: longDate },
    {
      title: tx('অবস্থা'),
      dataIndex: 'status',
      render: (s: string) => <span className={`wcd-tag wcd-tag-${s === 'paid' ? 'green' : s === 'cancelled' ? 'grey' : s === 'partial' ? 'amber' : 'red'}`}>{meta?.bill_statuses[s] ?? s}</span>,
    },
    {
      title: tx('কাজ'),
      key: 'act',
      align: 'center' as const,
      width: 70,
      render: (_: unknown, b: WaterBill) => (
        <button type="button" className="wcd-eye" aria-label={tx('বিস্তারিত')} onClick={() => setBill(b)}>
          <EyeOutlined />
        </button>
      ),
    },
  ]
  const receiptColumns = [
    { title: tx('রশিদের তারিখ'), dataIndex: 'date', render: longDate },
    { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v: string) => digits(v) },
    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right' as const, render: money },
    { title: tx('মাধ্যম'), dataIndex: 'method', render: (m: string) => meta?.methods[m] ?? m },
    { title: tx('অবস্থা'), dataIndex: 'status', render: (s: string) => <span className={`wcd-tag wcd-tag-${s === 'cancelled' ? 'grey' : 'green'}`}>{RECEIPT_STATUS_LABEL[s] ?? s}</span> },
    {
      title: tx('কাজ'),
      key: 'act',
      align: 'center' as const,
      width: 70,
      render: (_: unknown, r: Receipt) => (
        <Link to={`/water/receipts/${r.id}`} className="wcd-eye" aria-label={tx('রশিদ দেখুন')}>
          <EyeOutlined />
        </Link>
      ),
    },
  ]

  const quick = [
    { key: 'bill', tone: 'green', icon: <FileTextFilled />, label: tx('বিল তৈরি করুন'), onClick: () => navigate('/water/billing'), show: can('water.create') },
    { key: 'doc', tone: 'blue', icon: <FileAddFilled />, label: tx('ডকুমেন্ট যোগ'), onClick: openDocForm, show: canEdit },
    { key: 'pay', tone: 'orange', icon: <CreditCardFilled />, label: tx('টাকা গ্রহণ'), onClick: () => navigate(`/water/collect?connection=${c.id}`), show: can('water.create'), disabled: c.due <= 0 },
    { key: 'edit', tone: 'blue', icon: <EditOutlined />, label: tx('তথ্য সম্পাদনা'), onClick: () => setEditing(true), show: canEdit },
    { key: 'disconnect', tone: 'red', icon: <StopOutlined />, label: tx('বিচ্ছিন্ন করুন'), onClick: () => openAction('disconnect'), show: canEdit, disabled: c.status !== 'active' },
    { key: 'reconnect', tone: 'purple', icon: <LinkOutlined />, label: tx('পুনঃসংযোগ'), onClick: () => openAction('reconnect'), show: canEdit, disabled: c.status !== 'disconnected' },
  ].filter((q) => q.show)

  const overview = (
    <div className="wcd-grid">
      <div className="wcd-col">
        <Card
          icon={<UserOutlined />}
          title={tx('সংযোগ ও গ্রাহকের তথ্য')}
          extra={
            <>
              {statusPill}
              {canEdit && (
                <Button icon={<EditOutlined />} className="wcd-btn-blue-outline" onClick={() => setEditing(true)}>
                  {tx('সম্পাদনা')}
                </Button>
              )}
            </>
          }
        >
          <div className="wcd-info">
            <Rows
              rows={[
                [tx('গ্রাহক আইডি'), customerId ? <Link to={`/farmers/${c.farmer!.id}`}>{customerId}</Link> : null],
                [tx('গ্রাহকের নাম'), name],
                [tx('পিতা / স্বামীর নাম'), c.father_name],
                [tx('মোবাইল নম্বর'), c.mobile ? digits(c.mobile) : null],
                [tx('বিকল্প মোবাইল'), c.alt_mobile ? digits(c.alt_mobile) : null],
                [tx('গ্রাহকের ধরন'), nameOf(c.type)],
                [tx('জাতীয় পরিচয়পত্র (NID)'), c.nid ? digits(c.nid) : null],
                [
                  tx('ঠিকানা'),
                  area ? (
                    <>
                      {c.address || nameOf(c.village)}
                      {c.address && c.village && <small>{nameOf(c.village)}</small>}
                    </>
                  ) : null,
                ],
              ]}
            />
            <Rows
              rows={[
                [tx('সংযোগ নং'), digits(c.connection_no)],
                [tx('মিটার নং'), c.meter_no ? digits(c.meter_no) : null],
                [tx('সংযোগের তারিখ'), longDate(c.connected_on)],
                [tx('পাইপের মাপ'), c.pipe_size ? digits(c.pipe_size) : null],
                [tx('মাসিক ফি'), `৳ ${money(c.fee)}`],
                [tx('অবস্থা'), <span className={`wcd-tag wcd-tag-${statusTone}`}>{meta?.statuses[c.status] ?? c.status}</span>],
                [tx('অক্ষাংশ'), c.latitude != null ? digits(c.latitude.toFixed(4)) : null],
                [tx('দ্রাঘিমাংশ'), c.longitude != null ? digits(c.longitude.toFixed(4)) : null],
                [tx('মন্তব্য'), c.status !== 'active' && c.status_reason ? `${c.status_reason} (${longDate(c.status_date)})` : c.remarks],
              ]}
            />
          </div>
        </Card>

        <Card
          icon={<FileTextFilled />}
          title={tx('সাম্প্রতিক বিল')}
          extra={
            <button type="button" className="wcd-link" onClick={() => setTab('billing')}>
              {tx('সব বিল দেখুন')} <ArrowRightOutlined />
            </button>
          }
        >
          <Table<WaterBill> className="wcd-table" rowKey="id" size="small" pagination={false} dataSource={c.bills.slice(0, 5)} columns={billColumns} scroll={{ x: 640 }} locale={{ emptyText: tx('এখনো কোনো বিল হয়নি') }} />
        </Card>

        <Card
          icon={<DashboardFilled />}
          title={tx('সাম্প্রতিক পরিশোধ')}
          extra={
            <button type="button" className="wcd-link" onClick={() => setTab('billing')}>
              {tx('সব পরিশোধ দেখুন')} <ArrowRightOutlined />
            </button>
          }
        >
          <Table<Receipt> className="wcd-table" rowKey="id" size="small" pagination={false} dataSource={c.receipts.slice(0, 3)} columns={receiptColumns} scroll={{ x: 600 }} locale={{ emptyText: tx('এখনো কোনো টাকা জমা হয়নি') }} />
        </Card>
      </div>

      <div className="wcd-col">
        <Card
          icon={<PictureFilled />}
          title={tx('ছবি ও ডকুমেন্ট')}
          extra={
            canEdit && (
              <Button icon={<UploadOutlined />} className="wcd-btn-blue-outline" onClick={openDocForm}>
                {tx('আপলোড করুন')}
              </Button>
            )
          }
        >
          <div className="wcd-media">
            <figure className="wcd-photo">
              {photoSrc ? <img src={photoSrc} alt={tx('সংযোগের ছবি')} /> : <span className="wcd-photo-empty"><CameraOutlined /></span>}
              <figcaption>
                {tx('সংযোগের ছবি')}
                {canEdit && (
                  <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={uploadPhoto}>
                    <button type="button" className="wcd-link wcd-link-sm">
                      {c.photo ? tx('বদলান') : tx('ছবি দিন')}
                    </button>
                  </Upload>
                )}
              </figcaption>
            </figure>
            <ul className="wcd-docs">
              {c.documents.length === 0 && <li className="wcd-docs-empty">{tx('কোনো ডকুমেন্ট নেই')}</li>}
              {c.documents.slice(0, 4).map((d) => (
                <li key={d.id}>
                  <span className="wcd-doc-ic">
                    <FileTextOutlined />
                  </span>
                  <span className="wcd-doc-body">
                    <b title={d.original_name}>{d.title}</b>
                    <small>
                      {fileKind(d)} • {fileSize(d.size)}
                    </small>
                  </span>
                  <button type="button" className="wcd-doc-dl" aria-label={tx('ডাউনলোড')} onClick={() => openDoc(d)}>
                    <DownloadOutlined />
                  </button>
                  {canEdit && (
                    <Popconfirm title={tx('ডকুমেন্টটি মুছবেন?')} onConfirm={() => deleteDoc(d)}>
                      <button type="button" className="wcd-doc-del" aria-label={tx('মুছুন')}>
                        <DeleteOutlined />
                      </button>
                    </Popconfirm>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card
          icon={<EnvironmentFilled />}
          title={tx('অবস্থান')}
          extra={
            <a href={mapLink} target="_blank" rel="noreferrer" className="wcd-btn-outline-link">
              {tx('ম্যাপে দেখুন')}
            </a>
          }
        >
          <div className="wcd-map">
            {hasMap ? (
              <iframe
                title={tx('ম্যাপ')}
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${c.longitude! - 0.006},${c.latitude! - 0.0035},${c.longitude! + 0.006},${c.latitude! + 0.0035}&layer=mapnik&marker=${c.latitude},${c.longitude}`}
              />
            ) : (
              <div className="wcd-map-empty">
                <AimOutlined />
                <span>{canEdit ? tx('সম্পাদনায় অক্ষাংশ ও দ্রাঘিমাংশ দিলে এখানে ম্যাপ দেখাবে') : tx('ম্যাপের অবস্থান দেওয়া নেই')}</span>
              </div>
            )}
          </div>
          <div className="wcd-place">
            <EnvironmentFilled />
            <span className="wcd-place-text">
              <b>{c.address || nameOf(c.village) || '—'}</b>
              {c.address && c.village && <small>{nameOf(c.village)}</small>}
            </span>
            <a href={directions} target="_blank" rel="noreferrer" className="wcd-btn-outline-link wcd-dir">
              <SendOutlined /> {tx('দিকনির্দেশনা')}
            </a>
          </div>
        </Card>

        {quick.length > 0 && (
          <Card icon={<ThunderboltFilled />} title={tx('দ্রুত কাজ')}>
            <div className="wcd-quick">
              {quick.map((q) => (
                <button key={q.key} type="button" className={`wcd-q wcd-q-${q.tone}`} onClick={q.onClick} disabled={q.disabled}>
                  {q.icon}
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )

  const billing = (
    <div className="wcd-stack">
      <Card icon={<FileTextFilled />} title={tx('সব বিল ({{p0}})', { p0: digits(c.bills.length) })} extra={<span className="wcd-due">{tx('মোট বকেয়া')}: ৳ {money(c.due)}</span>}>
        <Table<WaterBill>
          className="wcd-table"
          rowKey="id"
          size="small"
          dataSource={c.bills}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          scroll={{ x: 760 }}
          columns={[
            ...billColumns.slice(0, 4),
            { title: tx('আদায়'), dataIndex: 'paid_amount', align: 'right' as const, render: money },
            { title: tx('বকেয়া'), dataIndex: 'due', align: 'right' as const, render: (v: number) => (v > 0 ? <strong className="wcd-red">{money(v)}</strong> : money(0)) },
            ...billColumns.slice(4),
          ]}
        />
      </Card>
      <Card icon={<DollarOutlined />} title={tx('পরিশোধ ও রশিদ ({{p0}})', { p0: digits(c.receipts.length) })}>
        <Table<Receipt> className="wcd-table" rowKey="id" size="small" dataSource={c.receipts} pagination={{ pageSize: 12, hideOnSinglePage: true }} columns={receiptColumns} scroll={{ x: 600 }} />
      </Card>
    </div>
  )

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0', borderRadius: 6 } }}>
      <div className="wcd">
        <div className="wcd-top">
          <nav className="wcd-crumb">
            <Link to="/">
              <HomeOutlined /> {tx('হোম')}
            </Link>
            <RightOutlined className="wcd-sep" />
            <span>{tx('পানি সরবরাহ')}</span>
            <RightOutlined className="wcd-sep" />
            <Link to="/water/connections" className="wcd-crumb-link">
              {tx('সংযোগ ও গ্রাহক')}
            </Link>
            <RightOutlined className="wcd-sep" />
            <b>{digits(c.connection_no)}</b>
          </nav>
          <div className="wcd-top-btns no-print">
            <Button icon={<ArrowLeftOutlined />} className="wcd-btn-blue-outline" onClick={() => navigate('/water/connections')}>
              {tx('তালিকায় ফিরুন')}
            </Button>
            {canEdit && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {tx('সম্পাদনা')}
              </Button>
            )}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              {tx('প্রিন্ট')}
            </Button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  ...(can('water.create') && c.due > 0 ? [{ key: 'pay', icon: <DollarOutlined />, label: tx('টাকা আদায়'), onClick: () => navigate(`/water/collect?connection=${c.id}`) }] : []),
                  ...(c.farmer ? [{ key: 'farmer', icon: <UserOutlined />, label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${c.farmer!.id}`) }] : []),
                  ...(canEdit && c.status === 'active' ? [{ key: 'disconnect', icon: <DisconnectOutlined />, label: tx('বিচ্ছিন্ন করুন'), onClick: () => openAction('disconnect') }] : []),
                  ...(canEdit && c.status === 'disconnected' ? [{ key: 'reconnect', icon: <LinkOutlined />, label: tx('পুনঃসংযোগ'), onClick: () => openAction('reconnect') }] : []),
                  ...(canEdit && c.status !== 'closed' ? [{ key: 'close', icon: <StopOutlined />, danger: true, label: tx('স্থায়ীভাবে বন্ধ করুন'), onClick: () => openAction('close') }] : []),
                ],
              }}
            >
              <Button>
                {tx('আরও')} <DownOutlined className="wcd-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <section className="wcd-hero">
          <div className="wcd-who">
            <span className="wcd-avatar">{initials(name)}</span>
            <span className="wcd-who-text">
              <small>{customerId ? tx('গ্রাহক আইডি') : tx('সংযোগ নং')}</small>
              <b className="wcd-id">{customerId ?? digits(c.connection_no)}</b>
              <span className="wcd-name">
                {name}
                <span className="wcd-tag wcd-tag-blue">{nameOf(c.type)}</span>
              </span>
              {statusPill}
            </span>
          </div>
          <div className="wcd-facts">
            {[
              { icon: <MobileFilled />, label: tx('মোবাইল নম্বর'), value: c.mobile ? digits(c.mobile) : '—' },
              { icon: <EnvironmentFilled />, label: tx('ঠিকানা'), value: c.address || nameOf(c.village) || '—', sub: c.address && c.village ? nameOf(c.village) : undefined },
              { icon: <IdcardFilled />, label: tx('সংযোগ নং'), value: digits(c.connection_no) },
              { icon: <DashboardFilled />, label: tx('মিটার নং'), value: c.meter_no ? digits(c.meter_no) : '—' },
              { icon: <CalendarFilled />, label: tx('সংযোগের তারিখ'), value: longDate(c.connected_on) },
            ].map((f) => (
              <div key={f.label} className="wcd-fact">
                <span className="wcd-fact-ic">{f.icon}</span>
                <span>
                  <small>{f.label}</small>
                  <b>{f.value}</b>
                  {f.sub && <em>{f.sub}</em>}
                </span>
              </div>
            ))}
          </div>
        </section>

        <nav className="wcd-tabs no-print">
          {(
            [
              ['overview', tx('এক নজরে')],
              ['billing', tx('বিল ও পরিশোধ')],
              ['activity', tx('কার্যক্রমের লগ')],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && overview}
        {tab === 'billing' && billing}
        {tab === 'activity' && (
          <Card icon={<FileTextOutlined />} title={tx('কার্যক্রমের লগ')}>
            <AuditLogTable data={activity.data} loading={activity.isFetching} page={actPage} onPage={setActPage} />
          </Card>
        )}

        <ConnectionForm open={editing} connection={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />

        <Modal open={!!action} title={action ? ACTION_TITLE[action] : ''} onCancel={() => setAction(null)} onOk={() => form.submit()} confirmLoading={busy} okText={tx('নিশ্চিত করুন')} destroyOnHidden>
          <Form form={form} layout="vertical" onFinish={changeStatus}>
            <Form.Item name="date" label={tx('তারিখ')} rules={[{ required: true }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
            {action === 'reconnect' && (
              <Form.Item name="fee" label={tx('পুনঃসংযোগ ফি')} extra={tx('০ দিলে কোনো ফি-র বিল হবে না।')}>
                <InputNumber min={0} style={{ width: '100%' }} prefix="৳" />
              </Form.Item>
            )}
            <Form.Item name="reason" label={tx('কারণ')} rules={action === 'reconnect' ? [] : [{ required: true, message: tx('কারণ লিখুন') }]}>
              <Input.TextArea rows={2} maxLength={300} />
            </Form.Item>
            {action === 'close' && <p style={{ color: '#888', margin: 0 }}>{tx('বকেয়া থাকলে সংযোগ বন্ধ করা যায় না। বন্ধ সংযোগে আর বিল হয় না।')}</p>}
            {action === 'disconnect' && <p style={{ color: '#888', margin: 0 }}>{tx('বিচ্ছিন্ন থাকা অবস্থায় মাসিক বিল হবে না; আগের বকেয়া থেকে যাবে।')}</p>}
          </Form>
        </Modal>

        <Modal open={docOpen} title={tx('ডকুমেন্ট আপলোড')} onCancel={() => setDocOpen(false)} onOk={() => docForm.submit()} confirmLoading={busy} okText={tx('আপলোড করুন')} destroyOnHidden>
          <Form form={docForm} layout="vertical" onFinish={saveDoc}>
            <Form.Item name="title" label={tx('ডকুমেন্টের নাম')} rules={[{ required: true, message: tx('নাম দিন') }]}>
              <AutoComplete options={DOC_TITLES.map((t) => ({ value: tx(t) }))} maxLength={100} placeholder={tx('যেমন: NID কপি')} />
            </Form.Item>
            <Form.Item
              name="file"
              label={tx('ফাইল (PDF, JPG বা PNG — সর্বোচ্চ ৫ MB)')}
              valuePropName="fileList"
              getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)?.slice(-1)}
              rules={[{ required: true, message: tx('ফাইল বাছাই করুন') }]}
            >
              <Upload accept=".pdf,image/png,image/jpeg" beforeUpload={() => false} maxCount={1}>
                <Button icon={<UploadOutlined />}>{tx('ফাইল বাছাই করুন')}</Button>
              </Upload>
            </Form.Item>
          </Form>
        </Modal>

        <Modal open={!!bill} title={bill ? `${tx('বিল')} ${digits(bill.bill_no)}` : ''} footer={null} onCancel={() => setBill(null)} destroyOnHidden>
          {bill && (
            <Rows
              rows={[
                [tx('কিসের বিল'), billLabel(bill)],
                [tx('বিলের তারিখ'), longDate(bill.bill_date)],
                [tx('শেষ তারিখ'), longDate(bill.due_date)],
                [tx('বিল'), `৳ ${money(bill.amount)}`],
                [tx('জরিমানা'), `৳ ${money(bill.penalty)}`],
                [tx('আদায়'), `৳ ${money(bill.paid_amount)}`],
                [tx('বকেয়া'), <strong className={bill.due > 0 ? 'wcd-red' : ''}>৳ {money(bill.due)}</strong>],
                [tx('অবস্থা'), meta?.bill_statuses[bill.status] ?? bill.status],
              ]}
            />
          )}
        </Modal>
      </div>
    </ConfigProvider>
  )
}
