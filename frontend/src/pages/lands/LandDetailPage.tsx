import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, ConfigProvider, DatePicker, Dropdown, Empty, Form, Input, InputNumber, Modal, Radio, Select, Spin, Table, Tabs, Tag, Tooltip, Upload } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditFilled,
  EyeFilled,
  FilePdfFilled,
  FileImageFilled,
  InfoCircleOutlined,
  MinusOutlined,
  PlusOutlined,
  PrinterFilled,
  StarFilled,
  SwapOutlined,
  UserOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import FarmerPicker from '../../components/FarmerPicker'
import OwnersEditor from '../../components/OwnersEditor'
import ProtectedImage from '../../components/ProtectedImage'
import { QrButton } from '../../components/QrLabel'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { CULTIVATION_COLOR, useLandMeta, type LandRow } from '../../lib/land'
import { openProtectedFile } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { AuditLog } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import './land-profile.css'

type Named = { id: number; name_bn: string; name_en: string | null } | null
type Period = { id: number; farmer_id: number; farmer: { id: number; farmer_code: string; name_bn: string; father_name: string }; start_date: string; end_date: string | null; remarks: string | null }
type Person = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null; nid: string | null; member_no: number | null; address: string; photo_url: string | null }
type Doc = { id: number; type: string; title: string | null; original_name: string; mime: string | null; created_at: string; uploader: Named }
type Note = { id: number; note: string; created_at: string; creator: Named }
type Invoice = { id: number; invoice_no: string; invoice_date: string; area_decimal: string; amount: string; paid_amount: string; status: string; cultivation_type: string; season: string | null; payer: string | null }
type LandDetail = LandRow & {
  latitude: number | null
  longitude: number | null
  location: string
  remarks: string | null
  district: string | null
  upazila: string | null
  union: string | null
  villages: string
  owner_history: (Period & { share_percent: string })[]
  cultivation_history: (Period & { type: string; terms: string | null })[]
  patwaris: { id: number; name: string; mobile: string }[]
  owner_cards: (Person & { share_percent: number })[]
  cultivator_card: Person | null
  related_farmers: (Person & { roles: string[] })[]
  irrigation: { irrigated_decimal: number; season: string | null; invoices: Invoice[] }
  documents: Doc[]
  notes: Note[]
  created_at: string
}
type Modal = 'transfer' | 'cultivation' | 'end' | 'document' | 'note' | null

const SQFT_PER_DECIMAL = 435.6
const acres = (decimal: number) => digits((decimal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const sqft = (decimal: number) => digits(Math.round(decimal * SQFT_PER_DECIMAL).toLocaleString('en-IN'))
const money = (v: number | string) => digits(Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const ROLE: Record<string, [string, string]> = {
  owner: [tx('মালিক'), 'lp-tag-blue'],
  former_owner: [tx('সাবেক মালিক'), 'lp-tag-gray'],
  cultivator: [tx('চাষি'), 'lp-tag-green'],
  former_cultivator: [tx('সাবেক চাষি'), 'lp-tag-gray'],
}

/** label : value rows, the way the approved design lays them out. */
function KV({ rows, className }: { rows: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={`lp-kv ${className ?? ''}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="lp-kv-row">
          <dt>{k}</dt>
          <span className="lp-colon">:</span>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function SectionTitle({ icon, children, extra }: { icon: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="lp-sec-title">
      <span className="lp-sec-icon">{icon}</span>
      <h3>{children}</h3>
      {extra && <span className="lp-sec-extra">{extra}</span>}
    </div>
  )
}

function PersonCard({ title, p, tag, tagClass, extra }: { title: string; p: Person | null; tag: string; tagClass: string; extra?: ReactNode }) {
  return (
    <div className="lp-card lp-person">
      <SectionTitle icon={<UserOutlined />}>{title}</SectionTitle>
      {p ? (
        <div className="lp-person-body">
          {p.photo_url ? <ProtectedImage url={p.photo_url} size={62} shape="square" /> : <span className="lp-avatar"><UserOutlined /></span>}
          <div className="lp-person-info">
            <div className="lp-person-name">
              <Link to={`/farmers/${p.id}`}>{nameOf(p)}</Link>
              <Tag className={`lp-tag ${tagClass}`}>{tag}</Tag>
              {extra}
            </div>
            <KV
              className="lp-kv-tight"
              rows={[
                [tx('সদস্য নং'), p.member_no ? digits(p.member_no) : tx('সদস্য নন')],
                [tx('মোবাইল'), digits(p.mobile ?? '') || '—'],
                ...(p.nid ? ([['NID', digits(p.nid)]] as [string, ReactNode][]) : []),
                [tx('ঠিকানা'), p.address || '—'],
              ]}
            />
          </div>
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tx('এখন কেউ নেই')} />
      )}
    </div>
  )
}

/**
 * Plots carry no GPS outline yet, so this draws a to-scale-free sketch of the
 * plot with its area, mouza and dag — the same place the design shows a map.
 */
function PlotSketch({ land }: { land: LandDetail }) {
  const [zoom, setZoom] = useState(1)
  return (
    <div className="lp-map">
      <svg viewBox="0 0 440 290" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <pattern id="lp-rows" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
            <rect width="18" height="18" fill="#6f7f4a" />
            <rect width="9" height="18" fill="#7d8c55" />
          </pattern>
          <pattern id="lp-rows2" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(62)">
            <rect width="14" height="14" fill="#8a8a5c" />
            <rect width="6" height="14" fill="#979866" />
          </pattern>
          <linearGradient id="lp-plot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2fae3f" />
            <stop offset="1" stopColor="#1d8a2d" />
          </linearGradient>
        </defs>
        <rect width="440" height="290" fill="url(#lp-rows)" />
        <polygon points="0,0 170,0 120,110 0,140" fill="url(#lp-rows2)" opacity="0.7" />
        <polygon points="300,290 440,180 440,290" fill="url(#lp-rows2)" opacity="0.7" />
        <path d="M0 250 Q 150 210 440 240" stroke="#b9ad86" strokeWidth="5" fill="none" opacity="0.8" />
        <g transform={`translate(220 140) scale(${zoom}) translate(-220 -140)`}>
          <polygon points="170,45 345,112 297,225 100,160" fill="url(#lp-plot)" fillOpacity="0.9" stroke="#fff" strokeWidth="2" />
          {[
            [170, 45],
            [345, 112],
            [297, 225],
            [100, 160],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill="#fff" />
          ))}
          <text x="222" y="133" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">
            {tx('{{p0}} একর', { p0: acres(land.area_decimal) })}
          </text>
        </g>
      </svg>
      <div className="lp-map-tools">
        <Button icon={<PlusOutlined />} aria-label={tx('বড় করুন')} onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))} />
        <Button icon={<MinusOutlined />} aria-label={tx('ছোট করুন')} onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} />
        <Tooltip title={tx('জমির GPS সীমানা এখনো সংরক্ষিত হয় না; এটি প্রতীকী নকশা, মাপ অনুযায়ী নয়।')} placement="left">
          <Button icon={<InfoCircleOutlined />} aria-label={tx('তথ্য')} />
        </Tooltip>
      </div>
      <div className="lp-map-label">
        <span className="lp-pin" />
        <div>
          {tx('মৌজা')}: {land.mouza}
          <br />
          {tx('দাগ নং')}: {digits(land.dag_no)}
          {land.latitude != null && land.longitude != null && (
            <>
              <br />
              <a href={`https://www.google.com/maps?q=${land.latitude},${land.longitude}`} target="_blank" rel="noreferrer">
                {tx('গুগল ম্যাপে দেখুন')}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LandDetailPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useLandMeta()
  const [modal, setModal] = useState<Modal>(null)
  const [tab, setTab] = useState(search.get('tab') ?? 'general')
  const [historyPage, setHistoryPage] = useState(1)
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<LandRow[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const { data: land, isLoading, error } = useQuery({
    queryKey: ['lands', id],
    queryFn: async () => (await api.get<LandDetail>(`/lands/${id}`)).data,
    enabled: !!id,
  })
  const audit = useQuery({
    queryKey: ['lands', id, 'history', historyPage],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/lands/${id}/history`, { params: { page: historyPage } })).data,
    placeholderData: keepPreviousData,
    enabled: !!id && tab === 'history',
  })

  /** Land no., dag, khatian or an owner's name → straight to the plot when only one matches. */
  const find = async () => {
    if (!q.trim()) return
    setFinding(true)
    try {
      const r = await api.get<Paginated<LandRow>>('/lands', { params: { search: q.trim(), per_page: 10 } })
      const exact = r.data.data.find((l) => l.land_code.toLowerCase() === q.trim().toLowerCase())
      if (exact || r.data.data.length === 1) {
        setMatches(null)
        setQ('')
        navigate(`/lands/${(exact ?? r.data.data[0]).id}`)
      } else setMatches(r.data.data)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setFinding(false)
    }
  }

  const open = (m: Modal) => {
    form.resetFields()
    if (m === 'transfer') form.setFieldsValue({ effective_date: dayjs(), owners: [{ share_percent: 100 }] })
    if (m === 'cultivation') form.setFieldsValue({ start_date: dayjs(), type: land?.cultivation?.type ?? 'own' })
    if (m === 'end') form.setFieldsValue({ end_date: dayjs() })
    if (m === 'document') form.setFieldsValue({ type: 'khatian' })
    setModal(m)
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['lands', id] })
    queryClient.invalidateQueries({ queryKey: ['lands'], predicate: (qq) => qq.queryKey[1] !== id })
    queryClient.invalidateQueries({ queryKey: ['farmers'] })
  }

  const submit = async () => {
    const v = await form.validateFields()
    const fmt = (d?: Dayjs) => d?.format('YYYY-MM-DD')
    setSaving(true)
    try {
      if (modal === 'document') {
        const fd = new FormData()
        fd.append('type', v.type)
        if (v.title) fd.append('title', v.title)
        fd.append('file', v.file.file)
        await api.post(`/lands/${id}/documents`, fd)
      } else if (modal === 'note') {
        await api.post(`/lands/${id}/notes`, { note: v.note })
      } else if (modal === 'transfer') {
        await api.post(`/lands/${id}/transfer`, { ...v, effective_date: fmt(v.effective_date) })
      } else if (modal === 'cultivation') {
        await api.post(`/lands/${id}/cultivation`, { ...v, start_date: fmt(v.start_date), contract_end: fmt(v.contract_end) ?? null })
      } else {
        await api.post(`/lands/${id}/cultivation/end`, { ...v, end_date: fmt(v.end_date) })
      }
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setModal(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const removeLand = () =>
    Modal.confirm({
      title: tx('জমির রেকর্ড মুছবেন?'),
      okText: tx('মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.delete(`/lands/${id}`)
          message.success(tx('মুছে ফেলা হয়েছে।'))
          queryClient.invalidateQueries({ queryKey: ['lands'] })
          navigate('/lands')
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const removeItem = (kind: 'documents' | 'notes', itemId: number) =>
    Modal.confirm({
      title: kind === 'documents' ? tx('ডকুমেন্ট মুছবেন?') : tx('নোট মুছবেন?'),
      okText: tx('মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.delete(`/lands/${id}/${kind}/${itemId}`)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const download = async (d: Doc) => {
    try {
      const res = await api.get(`/lands/${id}/documents/${d.id}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = d.original_name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const toolbar = (
    <div className="lp-toolbar no-print">
      <div className="lp-find">
        <Input
          value={q}
          allowClear
          placeholder={land ? land.land_code : tx('জমির নং, দাগ, খতিয়ান বা মালিকের নাম')}
          onChange={(e) => {
            setQ(e.target.value)
            if (!e.target.value) setMatches(null)
          }}
          onPressEnter={find}
        />
        <Button type="primary" className="lp-find-btn" loading={finding} onClick={find}>
          {tx('খুঁজুন')}
        </Button>
        {matches && (
          <div className="lp-matches">
            {matches.length ? (
              matches.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setMatches(null)
                    setQ('')
                    navigate(`/lands/${l.id}`)
                  }}
                >
                  <strong>{l.land_code}</strong>
                  <span>
                    {l.mouza} · {tx('দাগ')} {digits(l.dag_no)} · {l.owners.map((o) => o.name_bn).join(', ')}
                  </span>
                </button>
              ))
            ) : (
              <div className="lp-nomatch">{tx('কোনো জমি পাওয়া যায়নি')}</div>
            )}
          </div>
        )}
      </div>
      <Button
        className="lp-clear"
        onClick={() => {
          setQ('')
          setMatches(null)
          if (id) navigate('/lands/lookup')
        }}
      >
        {tx('খালি করুন')}
      </Button>
      {land && (
        <div className="lp-actions">
          {can('land.edit') && (
            <Button type="primary" icon={<EditFilled />} onClick={() => navigate(`/lands/${id}/edit`)}>
              {tx('জমি সম্পাদনা')}
            </Button>
          )}
          <Button icon={<SwapOutlined />} onClick={() => setTab('ownership')}>
            {tx('হস্তান্তরের ইতিহাস')}
          </Button>
          <Button icon={<PrinterFilled />} onClick={() => window.print()}>
            {tx('প্রিন্ট')}
          </Button>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                can('irrigation.create') && { key: 'invoice', label: tx('সেচ ইনভয়েস'), onClick: () => navigate(`/irrigation/invoices/new?land_id=${id}`) },
                can('land.edit') && { key: 'transfer', label: tx('মালিকানা হস্তান্তর'), onClick: () => open('transfer') },
                can('land.edit') && { key: 'cultivation', label: land.cultivation ? tx('চাষি পরিবর্তন') : tx('চাষি দিন'), onClick: () => open('cultivation') },
                can('land.edit') && land.cultivation && { key: 'end', label: tx('চাষ শেষ'), onClick: () => open('end') },
                can('land.delete') && { type: 'divider' as const },
                can('land.delete') && { key: 'delete', danger: true, label: tx('মুছুন'), onClick: removeLand },
              ].filter(Boolean) as never,
            }}
          >
            <Button>
              {tx('আরও')} <DownOutlined className="lp-caret" />
            </Button>
          </Dropdown>
          <QrButton type="land" code={land.land_code} title={`${land.mouza} · ${tx('দাগ')} ${digits(land.dag_no)}`} />
        </div>
      )}
    </div>
  )

  const shell = (body: ReactNode) => (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="lp">
        <h1 className="lp-title">{tx('জমির প্রোফাইল')}</h1>
        {toolbar}
        {body}
      </div>
    </ConfigProvider>
  )

  if (!id) return shell(<div className="lp-card lp-empty"><Empty description={tx('জমির নম্বর, দাগ, খতিয়ান বা মালিকের নাম দিয়ে খুঁজুন')} /></div>)
  if (error) return shell(<Alert type="error" showIcon title={errorMessage(error)} />)
  if (isLoading || !land) return shell(<Spin />)

  const statusTag = <Tag className={`lp-tag ${land.status === 'cultivated' ? 'lp-tag-green' : land.status === 'disputed' ? 'lp-tag-red' : 'lp-tag-gray'}`}>{meta?.statuses[land.status] ?? land.status}</Tag>
  const ownership = land.owners.length > 1 ? tx('যৌথ ({{p0}} জন)', { p0: digits(land.owners.length) }) : land.owners.length ? tx('একক') : '—'
  const areaText = tx('{{p0}} একর ({{p1}} বর্গফুট)', { p0: acres(land.area_decimal), p1: sqft(land.area_decimal) })
  const irrigated = Math.min(land.irrigation.irrigated_decimal, land.area_decimal)
  const periodText = (p: { start_date: string; end_date: string | null }) => `${fmtDate(p.start_date)} — ${p.end_date ? fmtDate(p.end_date) : tx('বর্তমান')}`
  const docName = (d: Doc) => d.title || meta?.document_types[d.type] || d.type
  const owner = land.owner_cards[0] ?? null
  const borga = land.cultivation_history.filter((c) => c.type !== 'own')

  const docTable = (full: boolean) => (
    <Table<Doc>
      className="lp-table"
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={land.documents}
      locale={{ emptyText: tx('কোনো ডকুমেন্ট নেই') }}
      columns={[
        { title: '#', width: 34, render: (_, __, i) => digits(i + 1) },
        { title: tx('ডকুমেন্টের নাম'), render: (_, d) => docName(d) },
        { title: tx('ফাইল'), width: 52, align: 'center', render: (_, d) => (d.mime?.includes('pdf') ? <FilePdfFilled className="lp-pdf" /> : <FileImageFilled className="lp-img" />) },
        { title: tx('আপলোডের তারিখ'), dataIndex: 'created_at', render: fmtDate },
        ...(full ? [{ title: tx('আপলোড করেছেন'), render: (_: unknown, d: Doc) => nameOf(d.uploader) || '—' }] : []),
        {
          title: tx('অ্যাকশন'),
          width: full ? 120 : 80,
          align: 'center' as const,
          render: (_: unknown, d: Doc) => (
            <span className="lp-doc-actions">
              <Button type="text" size="small" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => openProtectedFile(`/lands/${id}/documents/${d.id}`).catch((e) => message.error(errorMessage(e)))} />
              <Button type="text" size="small" icon={<DownloadOutlined />} aria-label={tx('ডাউনলোড')} onClick={() => download(d)} />
              {full && can('land.edit') && <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => removeItem('documents', d.id)} />}
            </span>
          ),
        },
      ]}
    />
  )

  const general = (
    <div className="lp-general">
      <div className="lp-card lp-block">
        <SectionTitle icon={<span className="lp-ico lp-ico-cal" />}>{tx('মৌলিক তথ্য')}</SectionTitle>
        <KV
          rows={[
            [tx('জমির নং'), land.land_code],
            [tx('মৌজা'), `${land.mouza} (JL ${digits(land.jl_no)})`],
            [tx('খতিয়ান নং'), `${meta?.surveys[land.survey] ?? land.survey} ${digits(land.khatian_no)}`],
            [tx('দাগ নং'), digits(land.dag_no)],
            [tx('জমির ধরন'), land.land_type ?? '—'],
            [tx('মালিকানার ধরন'), ownership],
            [tx('মোট পরিমাণ'), areaText],
            [tx('অবস্থান'), land.location || '—'],
            [tx('অবস্থা'), statusTag],
            [tx('মন্তব্য'), land.remarks || '—'],
          ]}
        />
      </div>
      <div className="lp-col">
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-area" />}>{tx('পরিমাণের বিবরণ')}</SectionTitle>
          <KV
            rows={[
              [tx('মোট পরিমাণ (একর)'), acres(land.area_decimal)],
              [tx('মোট পরিমাণ (বর্গফুট)'), sqft(land.area_decimal)],
              [tx('মোট পরিমাণ (শতক)'), digits(Number(land.area_decimal).toLocaleString('en-IN', { maximumFractionDigits: 2 }))],
              [tx('সেচকৃত জমি (একর)'), acres(irrigated)],
              [tx('সেচহীন জমি (একর)'), acres(Math.max(0, land.area_decimal - irrigated))],
            ]}
          />
        </div>
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-admin" />}>{tx('প্রশাসনিক তথ্য')}</SectionTitle>
          <KV
            rows={[
              [tx('জেলা'), land.district ?? '—'],
              [tx('উপজেলা'), land.upazila ?? '—'],
              [tx('ইউনিয়ন'), land.union ?? '—'],
              [tx('গ্রাম'), land.villages || '—'],
              [tx('পাটোয়ারী'), land.patwaris.length ? land.patwaris.map((p) => p.name).join(', ') : '—'],
            ]}
          />
        </div>
      </div>
      <div className="lp-col">
        <div className="lp-card lp-block">
          <SectionTitle
            icon={<span className="lp-ico lp-ico-doc" />}
            extra={can('land.edit') && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => open('document')}>{tx('ডকুমেন্ট যোগ করুন')}</Button>}
          >
            {tx('জমির ডকুমেন্ট')}
          </SectionTitle>
          {docTable(false)}
        </div>
        <div className="lp-card lp-block">
          <SectionTitle icon={<StarFilled className="lp-star" />} extra={can('land.edit') && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => open('note')}>{tx('নোট যোগ করুন')}</Button>}>
            {tx('নোট')}
          </SectionTitle>
          <Table<Note>
            className="lp-table"
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={land.notes}
            locale={{ emptyText: tx('কোনো নোট নেই') }}
            columns={[
              { title: '#', width: 34, render: (_, __, i) => digits(i + 1) },
              { title: tx('নোট'), dataIndex: 'note' },
              { title: tx('লিখেছেন'), render: (_, n) => nameOf(n.creator) || '—' },
              { title: tx('তারিখ'), dataIndex: 'created_at', width: 96, render: fmtDate },
              ...(can('land.edit') ? [{ title: '', width: 36, render: (_: unknown, n: Note) => <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => removeItem('notes', n.id)} /> }] : []),
            ]}
          />
        </div>
      </div>
    </div>
  )

  const cultivationTable = (rows: typeof land.cultivation_history) => (
    <Table
      className="lp-table"
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={rows}
      scroll={{ x: 700 }}
      locale={{ emptyText: tx('চাষের কোনো রেকর্ড নেই') }}
      columns={[
        { title: tx('চাষি'), render: (_, c) => <Link to={`/farmers/${c.farmer_id}`}>{c.farmer.name_bn}</Link> },
        { title: tx('পিতা'), render: (_, c) => c.farmer.father_name },
        { title: tx('চাষের ধরন'), dataIndex: 'type', render: (t) => <Tag color={CULTIVATION_COLOR[t]}>{meta?.cultivation_types[t]}</Tag> },
        { title: tx('শর্ত'), dataIndex: 'terms', render: (v) => v || '—' },
        { title: tx('সময়কাল'), render: (_, c) => (c.end_date ? periodText(c) : <Tag color="green">{periodText(c)}</Tag>) },
        { title: tx('মন্তব্য'), dataIndex: 'remarks', render: (v) => v || '—' },
      ]}
    />
  )

  const tabs = [
    { key: 'general', label: tx('সাধারণ তথ্য'), children: general },
    {
      key: 'ownership',
      label: tx('মালিকানার বিবরণ'),
      children: (
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-doc" />} extra={can('land.edit') && <Button size="small" icon={<SwapOutlined />} onClick={() => open('transfer')}>{tx('মালিকানা হস্তান্তর')}</Button>}>
            {tx('মালিকানা ও হস্তান্তরের ইতিহাস')}
          </SectionTitle>
          <Table
            className="lp-table"
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={land.owner_history}
            scroll={{ x: 600 }}
            columns={[
              { title: tx('মালিক'), render: (_, o) => <Link to={`/farmers/${o.farmer_id}`}>{o.farmer.name_bn}</Link> },
              { title: tx('পিতা'), render: (_, o) => o.farmer.father_name },
              { title: tx('অংশ'), dataIndex: 'share_percent', render: (v) => `${digits(Number(v))}%` },
              { title: tx('সময়কাল'), render: (_, o) => (o.end_date ? periodText(o) : <Tag color="green">{periodText(o)}</Tag>) },
              { title: tx('মন্তব্য'), dataIndex: 'remarks', render: (v) => v || '—' },
            ]}
          />
        </div>
      ),
    },
    {
      key: 'cultivation',
      label: tx('চাষের বিবরণ'),
      children: (
        <div className="lp-card lp-block">
          <SectionTitle
            icon={<span className="lp-ico lp-ico-area" />}
            extra={
              can('land.edit') && (
                <span className="lp-btns">
                  <Button size="small" onClick={() => open('cultivation')}>{land.cultivation ? tx('চাষি পরিবর্তন') : tx('চাষি দিন')}</Button>
                  {land.cultivation && <Button size="small" onClick={() => open('end')}>{tx('চাষ শেষ')}</Button>}
                </span>
              )
            }
          >
            {tx('চাষের ইতিহাস')}
          </SectionTitle>
          {cultivationTable(land.cultivation_history)}
        </div>
      ),
    },
    {
      key: 'borga',
      label: tx('বর্গা / লিজ'),
      children: (
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-area" />}>{tx('বর্গা ও লিজের রেকর্ড')}</SectionTitle>
          {cultivationTable(borga)}
        </div>
      ),
    },
    {
      key: 'irrigation',
      label: tx('সেচের বিবরণ'),
      children: (
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-area" />}>
            {tx('সেচ')} · {land.irrigation_type || tx('সেচের ধরন দেওয়া নেই')}
            {land.irrigation.season && <span className="lp-sub"> — {tx('সর্বশেষ মৌসুম: {{p0}}, সেচকৃত {{p1}} একর', { p0: land.irrigation.season, p1: acres(irrigated) })}</span>}
          </SectionTitle>
          <Table<Invoice>
            className="lp-table"
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={land.irrigation.invoices}
            scroll={{ x: 760 }}
            locale={{ emptyText: tx('এই জমির কোনো সেচ ইনভয়েস নেই') }}
            columns={[
              { title: tx('ইনভয়েস নং'), dataIndex: 'invoice_no' },
              { title: tx('মৌসুম'), dataIndex: 'season' },
              { title: tx('তারিখ'), dataIndex: 'invoice_date', render: fmtDate },
              { title: tx('প্রদানকারী'), dataIndex: 'payer' },
              { title: tx('পরিমাণ (শতক)'), dataIndex: 'area_decimal', render: (v) => digits(Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })) },
              { title: tx('টাকা'), dataIndex: 'amount', render: money },
              { title: tx('পরিশোধ'), dataIndex: 'paid_amount', render: money },
              { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag className={`lp-tag ${s === 'paid' ? 'lp-tag-green' : s === 'partial' ? 'lp-tag-gold' : 'lp-tag-red'}`}>{{ paid: tx('পরিশোধিত'), partial: tx('আংশিক'), unpaid: tx('বকেয়া') }[s as string] ?? s}</Tag> },
            ]}
          />
        </div>
      ),
    },
    {
      key: 'history',
      label: tx('জমির ইতিহাস'),
      children: (
        <div className="lp-card lp-block">
          <AuditLogTable data={audit.data} loading={audit.isFetching} page={historyPage} onPage={setHistoryPage} />
        </div>
      ),
    },
    {
      key: 'documents',
      label: tx('ডকুমেন্ট'),
      children: (
        <div className="lp-card lp-block">
          <SectionTitle icon={<span className="lp-ico lp-ico-doc" />} extra={can('land.edit') && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => open('document')}>{tx('ডকুমেন্ট যোগ করুন')}</Button>}>
            {tx('জমির ডকুমেন্ট')}
          </SectionTitle>
          {docTable(true)}
        </div>
      ),
    },
    {
      key: 'related',
      label: tx('সংশ্লিষ্ট কৃষক'),
      children: (
        <div className="lp-card lp-block">
          <Table
            className="lp-table"
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={land.related_farmers}
            scroll={{ x: 700 }}
            columns={[
              { title: tx('কৃষক নং'), dataIndex: 'farmer_code' },
              { title: tx('নাম'), render: (_, p) => <Link to={`/farmers/${p.id}`}>{nameOf(p)}</Link> },
              { title: tx('পিতার নাম'), dataIndex: 'father_name' },
              { title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
              { title: tx('সদস্য নং'), dataIndex: 'member_no', render: (v) => (v ? digits(v) : '—') },
              { title: tx('সম্পর্ক'), dataIndex: 'roles', render: (roles: string[]) => roles.map((r) => <Tag key={r} className={`lp-tag ${ROLE[r]?.[1]}`}>{ROLE[r]?.[0]}</Tag>) },
            ]}
          />
        </div>
      ),
    },
  ]

  return shell(
    <>
      <div className="lp-top">
        <div className="lp-card lp-summary">
          <div className="lp-summary-head">
            <span className="lp-land-icon" aria-hidden>
              <svg viewBox="0 0 40 40" width="40" height="40">
                <path d="M20 22c0-6 4-10 10-10 0 6-4 10-10 10zM20 22c0-5-3-8-8-8 0 5 3 8 8 8z" fill="#1f9d55" />
                <path d="M20 12v14" stroke="#1f9d55" strokeWidth="2.4" />
                <path d="M4 27c6-3 10-3 16 0s10 3 16 0M4 33c6-3 10-3 16 0s10 3 16 0" stroke="#1f9d55" strokeWidth="2.4" fill="none" />
              </svg>
            </span>
            <div>
              <span className="lp-muted">{tx('জমির নং')}</span>
              <div className="lp-code">
                {land.land_code} {statusTag}
              </div>
            </div>
          </div>
          <KV
            rows={[
              [tx('মৌজা'), land.mouza],
              [tx('খতিয়ান নং'), digits(land.khatian_no)],
              [tx('দাগ নং'), digits(land.dag_no)],
              [tx('জমির ধরন'), land.land_type ? <Tag className="lp-tag lp-tag-green">{land.land_type}</Tag> : '—'],
              [tx('মালিকানার ধরন'), <Tag className="lp-tag lp-tag-blue">{ownership}</Tag>],
              [tx('মোট পরিমাণ'), areaText],
              [tx('অবস্থান'), land.location || '—'],
              [tx('মন্তব্য'), land.remarks || '—'],
            ]}
          />
        </div>
        <div className="lp-card lp-map-card">
          <SectionTitle icon={<span className="lp-ico lp-ico-map" />}>{tx('জমির অবস্থান (নকশা)')}</SectionTitle>
          <PlotSketch land={land} />
        </div>
        <div className="lp-people">
          <PersonCard
            title={tx('মালিকের তথ্য')}
            p={owner}
            tag={tx('মালিক')}
            tagClass="lp-tag-blue"
            extra={land.owner_cards.length > 1 && <a className="lp-more-owners" onClick={() => setTab('ownership')}>{tx('+{{p0}} জন', { p0: digits(land.owner_cards.length - 1) })}</a>}
          />
          <PersonCard
            title={tx('বর্তমান চাষি')}
            p={land.cultivator_card}
            tag={land.cultivation ? (meta?.cultivation_types[land.cultivation.type] ?? tx('চাষি')) : tx('চাষি')}
            tagClass="lp-tag-green"
          />
        </div>
      </div>

      <Tabs className="lp-tabs" activeKey={tab} onChange={setTab} items={tabs} />

      <Modal
        open={!!modal}
        forceRender
        width={modal === 'transfer' ? 640 : 520}
        title={
          {
            transfer: tx('মালিকানা হস্তান্তর'),
            cultivation: land.cultivation ? tx('চাষি পরিবর্তন') : tx('চাষি দিন'),
            end: tx('চাষ শেষ'),
            document: tx('ডকুমেন্ট যোগ করুন'),
            note: tx('নোট যোগ করুন'),
          }[modal ?? 'end']
        }
        onCancel={() => setModal(null)}
        onOk={submit}
        confirmLoading={saving}
        okText={tx('সংরক্ষণ')}
        cancelText={tx('বাতিল')}
      >
        <Form form={form} layout="vertical">
          {modal === 'transfer' && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('বর্তমান মালিকানা এই তারিখে শেষ হবে এবং নতুন মালিকানা শুরু হবে। \'নিজ চাষ\' করা চাষি নতুন মালিকদের মধ্যে না থাকলে তার চাষও শেষ হবে।')} />
              <OwnersEditor />
              <Form.Item name="effective_date" label={tx('কার্যকর তারিখ')} rules={[required(tx('তারিখ দিন'))]} style={{ marginTop: 12 }}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Form.Item name="remarks" label={tx('মন্তব্য (দলিল নং ইত্যাদি)')}>
                <Input />
              </Form.Item>
            </>
          )}
          {modal === 'cultivation' && (
            <>
              <Form.Item name="type" label={tx('চাষের ধরন')}>
                <Radio.Group options={Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="farmer_id" label={tx('নতুন চাষি')} rules={[required(tx('চাষি বাছাই করুন'))]}>
                <FarmerPicker />
              </Form.Item>
              <Form.Item name="terms" label={tx('শর্ত')}>
                <Input />
              </Form.Item>
              <Form.Item name="start_date" label={tx('শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
                {({ getFieldValue }) =>
                  getFieldValue('type') !== 'own' && (
                    <div className="lp-cult-extra">
                      <Form.Item name="share_percent" label={tx('ফসলের অংশ (%)')}>
                        <InputNumber min={0.01} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name="contract_end" label={tx('চুক্তি শেষের তারিখ')}>
                        <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                      </Form.Item>
                    </div>
                  )
                }
              </Form.Item>
            </>
          )}
          {modal === 'end' && (
            <>
              <Form.Item name="end_date" label={tx('শেষের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
              <Form.Item name="remarks" label={tx('কারণ')}>
                <Input />
              </Form.Item>
            </>
          )}
          {modal === 'document' && (
            <>
              <Form.Item name="type" label={tx('ডকুমেন্টের ধরন')} rules={[{ required: true }]}>
                <Select options={Object.entries(meta?.document_types ?? {}).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="title" label={tx('নাম (ঐচ্ছিক)')}>
                <Input maxLength={150} />
              </Form.Item>
              <Form.Item name="file" label={tx('ফাইল (PDF বা ছবি, সর্বোচ্চ ৫ MB)')} rules={[{ required: true, message: tx('ফাইল বাছাই করুন') }]}>
                <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.jpg,.jpeg,.png">
                  <Button icon={<UploadOutlined />}>{tx('ফাইল বাছাই করুন')}</Button>
                </Upload>
              </Form.Item>
            </>
          )}
          {modal === 'note' && (
            <Form.Item name="note" label={tx('নোট')} rules={[required(tx('নোট লিখুন'))]}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>,
  )
}
