import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, ConfigProvider, DatePicker, Dropdown, Input, Modal, Pagination, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EllipsisOutlined,
  EyeFilled,
  FileTextOutlined,
  FilePdfOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  RollbackOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { APPLICATION_STATUS, downloadExport, openProtectedFile, useFarmerMeta } from '../../lib/phase2'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { DocThumb, UploadDocModal, useRemoveDoc, type Doc } from '../farmers/ProfileTabs'
import '../farmers/farmer-list.css'
import '../farmers/farmer-profile.css'
import './application-list.css'

type Farmer = { id: number; farmer_code: string; name_bn: string; name_en: string | null; father_name: string; mobile: string | null; nid: string | null; mouza: { name_bn: string } | null }
type Row = {
  id: number
  application_no: string
  applied_on: string
  admission_fee: string
  fee_status: 'paid' | 'due'
  initial_shares: number | null
  status: string
  farmer: Farmer
  photo_url: string | null
  member: { member_no: number } | null
  approval_request: { id: number; status: string; current_step: number; total_steps: number } | null
}
type Detail = Row & {
  farmer_id: number
  approval_request_id: number | null
  remarks: string | null
  fee_override_reason: string | null
  default_fee: string
  farmer_address: string | null
  share_unit_price: number
  can_act: boolean
  has_form_scan: boolean
  has_signature: boolean
  creator: { name_bn: string; name_en: string | null } | null
}
type Summary = { total: number; pending: number; approved: number; rejected: number; fee_due: number }
type Filters = { search?: string; status?: string; fee_status?: string; mouza_id?: number; from?: string; to?: string }
type Params = Filters & { page: number; per_page: number }

const EDITABLE = ['draft', 'returned']
const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const tk = (v: number) => '৳ ' + digits(v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const STATUS_CLASS: Record<string, string> = { draft: 'gray', pending: 'gold', approved: 'green', rejected: 'red', returned: 'orange', cancelled: 'gray' }

/** Pending on a later approval step reads as "under review", like the approved design. */
function statusTag(r: Pick<Row, 'status' | 'approval_request'>) {
  const review = r.status === 'pending' && (r.approval_request?.current_step ?? 1) > 1
  return <Tag className={`fl-tag al-tag-${review ? 'blue' : STATUS_CLASS[r.status] ?? 'gray'}`}>{review ? tx('পর্যালোচনাধীন') : APPLICATION_STATUS[r.status]?.label ?? r.status}</Tag>
}
const feeTag = (s: string) => <Tag className={`fl-tag ${s === 'paid' ? 'fl-tag-green' : 'fl-tag-red'}`}>{s === 'paid' ? tx('পরিশোধিত') : tx('বাকি')}</Tag>

/** Thumbnail of the application's own scan / signature (image or PDF). */
function AppFileThumb({ appId, kind }: { appId: number; kind: 'form_scan' | 'signature' }) {
  const [src, setSrc] = useState<string>()
  const [pdf, setPdf] = useState(false)
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    api
      .get(`/membership-applications/${appId}/file/${kind}`, { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        if (!String(r.data.type).startsWith('image/')) return setPdf(true)
        url = URL.createObjectURL(r.data)
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [appId, kind])
  return <div className="fp-thumb">{pdf ? <FilePdfOutlined className="fp-thumb-icon" /> : src && <img src={src} alt="" />}</div>
}

function Details({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [tab, setTab] = useState<'docs' | 'payment' | 'remarks'>('docs')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [decision, setDecision] = useState<'reject' | 'return' | null>(null)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)

  const { data: a } = useQuery({
    queryKey: ['membership-applications', String(id), 'detail'],
    queryFn: async () => (await api.get<Detail>(`/membership-applications/${id}`)).data,
  })
  const farmerId = a?.farmer_id ?? 0
  const docs = useQuery({
    queryKey: ['farmers', farmerId, 'documents'],
    queryFn: async () => (await api.get<Doc[]>(`/farmers/${farmerId}/documents`)).data,
    enabled: !!farmerId && can('farmer.view'),
  })
  const removeDoc = useRemoveDoc(farmerId)
  if (!a) return <section className="fl-card al-detail al-detail-loading" />

  const farmerDocs = (docs.data ?? []).filter((d) => d.type === 'nid_front' || d.type === 'nid_back' || d.type === 'other')
  const docCount = farmerDocs.length + (a.has_form_scan ? 1 : 0) + (a.has_signature ? 1 : 0)
  const remarkCount = [a.remarks, a.fee_override_reason].filter(Boolean).length
  const fee = Number(a.admission_fee)
  const shares = a.initial_shares ?? 0
  const editable = EDITABLE.includes(a.status) && can(['membership.create', 'membership.edit'])
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['membership-applications'] })
    queryClient.invalidateQueries({ queryKey: ['approvals'] })
  }

  const act = async (d: 'approve' | 'reject' | 'return', remarks?: string) => {
    if (!a.approval_request_id) return
    setActing(true)
    try {
      await api.post(`/approvals/${a.approval_request_id}/decide`, { decision: d, remarks })
      message.success(d === 'approve' ? tx('অনুমোদন করা হয়েছে।') : d === 'reject' ? tx('প্রত্যাখ্যান করা হয়েছে।') : tx('সংশোধনের জন্য ফেরত পাঠানো হয়েছে।'))
      setDecision(null)
      setReason('')
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setActing(false)
    }
  }
  const approve = () =>
    modal.confirm({
      title: tx('আবেদনটি অনুমোদন করবেন?'),
      content: a.approval_request && a.approval_request.current_step < a.approval_request.total_steps ? tx('এটি ধাপ {{p0}}/{{p1}}; পরের ধাপে পাঠানো হবে।', { p0: digits(a.approval_request.current_step), p1: digits(a.approval_request.total_steps) }) : undefined,
      okText: tx('অনুমোদন দিন'),
      cancelText: tx('না'),
      onOk: () => act('approve'),
    })

  const moreItems = [
    { key: 'open', icon: <FileTextOutlined />, label: tx('আবেদন খুলুন'), onClick: () => navigate(`/membership/applications/${a.id}`) },
    a.approval_request_id && { key: 'approval', icon: <AuditOutlined />, label: tx('অনুমোদনের অবস্থা'), onClick: () => navigate(`/approvals/${a.approval_request_id}`) },
    a.can_act && a.status === 'pending' && { key: 'return', icon: <RollbackOutlined />, label: tx('সংশোধনের জন্য ফেরত'), onClick: () => setDecision('return') },
    { key: 'print', icon: <PrinterOutlined />, label: tx('আবেদনপত্র প্রিন্ট'), onClick: () => navigate(`/membership/applications/${a.id}`) },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  return (
    <section className="fl-card al-detail">
      <header className="al-detail-head">
        <h3>
          <AuditOutlined /> {tx('আবেদনের বিবরণ: {{p0}}', { p0: a.application_no })}
        </h3>
        <button type="button" className="al-close" onClick={onClose} aria-label={tx('বন্ধ')}>
          <CloseOutlined />
        </button>
      </header>
      <div className="al-detail-body">
        <div className="al-farmer">
          <div className="al-photo">{a.photo_url ? <ProtectedImage url={a.photo_url} size={133} /> : <DashIcon name="users" size={48} color="#a7b3c4" />}</div>
          <div className="al-farmer-info">
            <div className="al-name">
              <h4>{nameOf(a.farmer)}</h4>
              {statusTag(a)}
            </div>
            <dl className="al-dl">
              <dt>{tx('কৃষক আইডি')}</dt>
              <dd>
                <Link to={`/farmers/${a.farmer_id}`}>{a.farmer.farmer_code}</Link>
              </dd>
              <dt>{tx('মোবাইল')}</dt>
              <dd>{digits(a.farmer.mobile) || '—'}</dd>
              <dt>NID</dt>
              <dd>{digits(a.farmer.nid) || '—'}</dd>
              <dt>{tx('পিতার নাম')}</dt>
              <dd>{a.farmer.father_name}</dd>
              <dt>{tx('মৌজা')}</dt>
              <dd>{a.farmer.mouza?.name_bn ?? '—'}</dd>
              <dt>{tx('ঠিকানা')}</dt>
              <dd>{a.farmer_address ?? '—'}</dd>
            </dl>
          </div>
        </div>

        <div className="al-info">
          <div className="al-info-head">
            <h4>
              <FileTextOutlined /> {tx('আবেদনের তথ্য')}
            </h4>
            {editable && (
              <Button size="small" icon={<EditOutlined />} className="al-mini" onClick={() => navigate(`/membership/applications/${a.id}`)}>
                {tx('সম্পাদনা')}
              </Button>
            )}
          </div>
          <dl className="al-dl al-dl-info">
            <dt>{tx('আবেদন নং')}</dt>
            <dd>{a.application_no}</dd>
            <dt>{tx('আবেদনের তারিখ')}</dt>
            <dd>{fmtDate(a.applied_on)}</dd>
            <dt>{tx('সদস্যপদের ধরন')}</dt>
            <dd>{a.member ? tx('সদস্য নং {{p0}}', { p0: digits(a.member.member_no) }) : tx('সাধারণ সদস্য')}</dd>
            <dt>{tx('ভর্তি ফি')}</dt>
            <dd>{tk(fee)}</dd>
            <dt>{tx('প্রাথমিক শেয়ার')}</dt>
            <dd>{shares ? tx('{{p0}} ({{p1}} শেয়ার × {{p2}})', { p0: tk(shares * a.share_unit_price), p1: digits(shares), p2: tk(a.share_unit_price) }) : '—'}</dd>
            <dt>{tx('মোট টাকা')}</dt>
            <dd>{tk(fee + shares * a.share_unit_price)}</dd>
            <dt>{tx('ফি পরিশোধ')}</dt>
            <dd>{feeTag(a.fee_status)}</dd>
            <dt>{tx('আবেদন করেছেন')}</dt>
            <dd>{a.creator ? nameOf(a.creator) : '—'}</dd>
          </dl>
        </div>

        <div className="al-side">
          <div className="al-tabs" role="tablist">
            <button type="button" className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>
              {tx('ডকুমেন্ট ({{p0}})', { p0: digits(docCount) })}
            </button>
            <button type="button" className={tab === 'payment' ? 'active' : ''} onClick={() => setTab('payment')}>
              {tx('পেমেন্টের ইতিহাস ({{p0}})', { p0: digits(1) })}
            </button>
            <button type="button" className={tab === 'remarks' ? 'active' : ''} onClick={() => setTab('remarks')}>
              {tx('মন্তব্য ({{p0}})', { p0: digits(remarkCount) })}
            </button>
          </div>
          <div className="al-tab-body">
            {tab === 'docs' && (
              <>
                <div className="al-docs">
                  {farmerDocs.map((d) => (
                    <figure key={d.id} className="al-doc">
                      <button type="button" className="al-doc-open" onClick={() => openProtectedFile(`/farmers/${farmerId}/documents/${d.id}`).catch((e) => message.error(errorMessage(e)))}>
                        <DocThumb farmerId={farmerId} doc={d} />
                      </button>
                      <figcaption>
                        <span>{meta?.document_types[d.type] ?? d.type}</span>
                        {can('farmer.edit') && <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => removeDoc(d)} />}
                      </figcaption>
                    </figure>
                  ))}
                  {(['form_scan', 'signature'] as const)
                    .filter((k) => (k === 'form_scan' ? a.has_form_scan : a.has_signature))
                    .map((k) => (
                      <figure key={k} className="al-doc">
                        <button type="button" className="al-doc-open" onClick={() => openProtectedFile(`/membership-applications/${a.id}/file/${k}`).catch((e) => message.error(errorMessage(e)))}>
                          <AppFileThumb appId={a.id} kind={k} />
                        </button>
                        <figcaption>
                          <span>{k === 'form_scan' ? tx('সদস্যপদ ফর্ম') : tx('স্বাক্ষর / টিপসই')}</span>
                        </figcaption>
                      </figure>
                    ))}
                  {docCount === 0 && <p className="al-empty">{tx('কোনো ডকুমেন্ট নেই')}</p>}
                </div>
                {can('farmer.edit') && (
                  <div className="al-upload">
                    <Button size="small" icon={<UploadOutlined />} className="al-mini" onClick={() => setUploadOpen(true)}>
                      {tx('ডকুমেন্ট আপলোড')}
                    </Button>
                    <span>{tx('JPG, PNG বা PDF (প্রতিটি সর্বোচ্চ ৫MB)')}</span>
                  </div>
                )}
              </>
            )}
            {tab === 'payment' && (
              <table className="al-mini-table">
                <thead>
                  <tr>
                    <th>{tx('বিষয়')}</th>
                    <th>{tx('টাকা')}</th>
                    <th>{tx('অবস্থা')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{tx('ভর্তি ফি')}</td>
                    <td>{tk(fee)}</td>
                    <td>{feeTag(a.fee_status)}</td>
                  </tr>
                  {shares > 0 && (
                    <tr>
                      <td>{tx('প্রাথমিক শেয়ার')}</td>
                      <td>{tk(shares * a.share_unit_price)}</td>
                      <td>{a.member ? tx('সদস্য হওয়ার পর শেয়ার হিসাবে জমা') : tx('অনুমোদনের পর')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {tab === 'remarks' && (
              <div className="al-remarks">
                {a.remarks && <p>{a.remarks}</p>}
                {a.fee_override_reason && (
                  <p>
                    <strong>{tx('ফি ভিন্ন হওয়ার কারণ:')}</strong> {a.fee_override_reason}
                  </p>
                )}
                {!remarkCount && <p className="al-empty">{tx('কোনো মন্তব্য নেই')}</p>}
                {a.approval_request_id && <Link to={`/approvals/${a.approval_request_id}`}>{tx('অনুমোদনের মন্তব্য দেখুন')}</Link>}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="al-actions">
        {a.can_act && a.status === 'pending' && (
          <>
            <Button icon={<CloseCircleOutlined />} className="al-reject" onClick={() => setDecision('reject')}>
              {tx('প্রত্যাখ্যান')}
            </Button>
            <Button type="primary" icon={<CheckCircleOutlined />} loading={acting} onClick={approve}>
              {tx('অনুমোদন দিন')}
            </Button>
          </>
        )}
        <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="topRight">
          <Button icon={<EllipsisOutlined />} aria-label={tx('আরও')} />
        </Dropdown>
      </footer>

      <UploadDocModal farmerId={farmerId} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <Modal
        open={!!decision}
        title={decision === 'reject' ? tx('আবেদন প্রত্যাখ্যান') : tx('সংশোধনের জন্য ফেরত')}
        okText={decision === 'reject' ? tx('প্রত্যাখ্যান') : tx('ফেরত পাঠান')}
        okButtonProps={{ danger: decision === 'reject', disabled: !reason.trim(), loading: acting }}
        cancelText={tx('বাতিল')}
        onCancel={() => setDecision(null)}
        onOk={() => decision && act(decision, reason.trim())}
      >
        <Input.TextArea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('কারণ লিখুন (আবশ্যক)')} />
      </Modal>
    </section>
  )
}

export default function ApplicationListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const [params, setParams] = useState<Params>({ page: 1, per_page: 5 })
  const [draft, setDraft] = useState<Filters>({})
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [closed, setClosed] = useState(false)

  const { data, isFetching } = useQuery({
    queryKey: ['membership-applications', params],
    queryFn: async () => (await api.get<Paginated<Row>>('/membership-applications', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['membership-applications', 'summary'], queryFn: async () => (await api.get<Summary>('/membership-applications/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const rows = useMemo(() => data?.data ?? [], [data])
  const total = data?.total ?? 0
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)
  // the first row on the page is shown in the details panel until another is picked
  const detailId = closed ? null : openId && rows.some((r) => r.id === openId) ? openId : rows[0]?.id ?? null

  const apply = () => setParams((p) => ({ page: 1, per_page: p.per_page, ...draft, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))
  const reset = () => {
    setDraft({})
    setRange(null)
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }
  const exportCsv = async () => {
    try {
      await downloadExport('/membership-applications', { ...params, page: undefined, per_page: undefined, export: 'csv' }, 'membership-applications.csv')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }
  const open = (id: number) => {
    setOpenId(id)
    setClosed(false)
  }

  const s = summary.data
  const cards = [
    { key: 'total', label: tx('মোট আবেদন'), value: s?.total, icon: 'file', color: '#2563eb', tint: '#e4edfd', filter: {} },
    { key: 'pending', label: tx('পর্যালোচনার অপেক্ষায়'), value: s?.pending, icon: 'calendar', color: '#f08c00', tint: '#fdf0dc', tone: 'orange', filter: { status: 'pending' } },
    { key: 'approved', label: tx('অনুমোদিত'), value: s?.approved, icon: 'userCheck', color: '#1f9d55', tint: '#e3f5ea', tone: 'green', filter: { status: 'approved' } },
    { key: 'rejected', label: tx('প্রত্যাখ্যাত'), value: s?.rejected, icon: 'userX', color: '#e0383e', tint: '#fde6e7', tone: 'red', filter: { status: 'rejected' } },
    { key: 'fee', label: tx('ভর্তি ফি বাকি'), value: s?.fee_due, icon: 'layers', color: '#6d4ae6', tint: '#ece7fc', tone: 'purple', filter: { fee_status: 'due' } },
  ]

  const columns: ColumnsType<Row> = [
    { title: '#', width: 42, align: 'center', render: (_, __, i) => digits(from + i) },
    { title: '', width: 50, render: (_, r) => <ProtectedImage url={r.photo_url} size={34} shape="square" /> },
    { title: tx('আবেদন নং'), dataIndex: 'application_no', render: (v, r) => <Link to={`/membership/applications/${r.id}`} className="fl-link">{v}</Link> },
    { title: tx('কৃষকের নাম'), render: (_, r) => <Link to={`/farmers/${r.farmer.id}`} className="fl-name">{nameOf(r.farmer)}</Link> },
    { title: tx('মোবাইল'), render: (_, r) => digits(r.farmer.mobile) || '—' },
    { title: 'NID', render: (_, r) => digits(r.farmer.nid) || '—' },
    { title: tx('মৌজা'), render: (_, r) => r.farmer.mouza?.name_bn ?? '—' },
    { title: tx('আবেদনের তারিখ'), dataIndex: 'applied_on', render: fmtDate },
    { title: tx('ভর্তি ফি'), dataIndex: 'admission_fee', render: (v) => tk(Number(v)) },
    { title: tx('অবস্থা'), render: (_, r) => statusTag(r) },
    { title: tx('পেমেন্ট'), dataIndex: 'fee_status', render: feeTag },
    {
      title: tx('অ্যাকশন'),
      width: 132,
      render: (_, r) => {
        const editable = EDITABLE.includes(r.status) && can(['membership.create', 'membership.edit'])
        const items = [
          { key: 'open', icon: <FileTextOutlined />, label: tx('আবেদন খুলুন'), onClick: () => navigate(`/membership/applications/${r.id}`) },
          { key: 'farmer', icon: <EyeFilled />, label: tx('কৃষকের প্রোফাইল'), onClick: () => navigate(`/farmers/${r.farmer.id}`) },
          r.approval_request && { key: 'approval', icon: <AuditOutlined />, label: tx('অনুমোদনের অবস্থা'), onClick: () => navigate(`/approvals/${r.approval_request!.id}`) },
        ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
        return (
          <div className="fl-actions">
            <Button className={`fl-act fl-act-view ${detailId === r.id ? 'al-on' : ''}`} icon={<EyeFilled />} aria-label={tx('বিবরণ দেখুন')} onClick={() => open(r.id)} />
            <Button className="fl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!editable} onClick={() => navigate(`/membership/applications/${r.id}`)} />
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button className="fl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
            </Dropdown>
          </div>
        )
      },
    },
  ]

  const moreItems = [
    can('member.view') && { key: 'members', label: tx('সদস্য তালিকা'), onClick: () => navigate('/members') },
    can('member.view') && { key: 'register', label: tx('ভর্তি রেজিস্টার'), onClick: () => navigate('/members/admission-register') },
    { key: 'approvals', label: tx('অনুমোদন'), onClick: () => navigate('/approvals') },
    { key: 'excel', icon: <DownloadOutlined />, label: 'Excel', onClick: exportCsv },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl al">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('সদস্যপদ আবেদন')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('সদস্যপদ আবেদন')}</h1>
            <p>{tx('নতুন সদস্যপদের আবেদন পরিচালনা করুন। ডকুমেন্ট যাচাই, ভর্তি ফি আদায় ও আবেদন অনুমোদন করুন।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('membership.create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/membership/applications/new')}>
                {tx('নতুন সদস্যপদ আবেদন')}
              </Button>
            )}
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button>
                {tx('আরও')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats al-stats">
          {cards.map((c) => (
            <button key={c.key} type="button" className="fl-stat" style={{ ['--tint' as string]: c.tint }} onClick={() => (c.key === 'total' ? reset() : setParams((p) => ({ page: 1, per_page: p.per_page, ...c.filter })))}>
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-row">
                  <span className={`fl-stat-value al-tone-${c.tone ?? ''}`}>{c.value === undefined ? '—' : n0(c.value)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="fl-card fl-filters al-filters">
          <div className="fl-filter-row">
            <div className="fl-field fl-field-search">
              <span className="al-hidden-label">&nbsp;</span>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder={tx('নাম, মোবাইল, NID, আবেদন নং দিয়ে খুঁজুন...')}
                value={draft.search}
                onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
                onPressEnter={apply}
              />
            </div>
            <div className="fl-field">
              <span>{tx('আবেদনের অবস্থা')}</span>
              <Select
                value={draft.status ?? ''}
                options={[{ value: '', label: tx('সকল') }, ...Object.entries(APPLICATION_STATUS).map(([value, st]) => ({ value, label: st.label }))]}
                onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('পেমেন্টের অবস্থা')}</span>
              <Select
                value={draft.fee_status ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: 'paid', label: tx('পরিশোধিত') },
                  { value: 'due', label: tx('বাকি') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, fee_status: v || undefined }))}
              />
            </div>
            <div className="fl-field">
              <span>{tx('মৌজা')}</span>
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                value={draft.mouza_id ?? ''}
                options={[{ value: '', label: tx('সকল মৌজা') }, ...(mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) }))]}
                onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))}
              />
            </div>
            <div className="fl-field al-range">
              <span>{tx('তারিখের পরিসর')}</span>
              <DatePicker.RangePicker format="DD-MM-YYYY" value={range} onChange={(r) => setRange(r as [Dayjs | null, Dayjs | null] | null)} placeholder={[tx('শুরু'), tx('শেষ')]} />
            </div>
            <div className="fl-filter-btns">
              <Button type="primary" icon={<SearchOutlined />} onClick={apply}>
                {tx('খুঁজুন')}
              </Button>
              <Button onClick={reset}>{tx('রিসেট')}</Button>
            </div>
          </div>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head al-table-head">
            <h3>{tx('সদস্যপদ আবেদন ({{p0}})', { p0: n0(total) })}</h3>
            <div className="fl-table-tools">
              <Button icon={<DownloadOutlined />} className="fl-export al-export" onClick={exportCsv}>
                {tx('এক্সপোর্ট')}
              </Button>
            </div>
          </div>
          <Table<Row>
            className="fl-table al-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1150 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 40 }}
            rowClassName={(r) => (r.id === detailId ? 'al-row-on' : '')}
            onRow={(r) => ({ onDoubleClick: () => open(r.id) })}
            columns={columns}
            locale={{ emptyText: tx('কোনো আবেদন নেই') }}
          />
          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}}টি আবেদন', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
            <Pagination
              className="fl-pager"
              current={params.page}
              pageSize={params.per_page}
              total={total}
              showSizeChanger={false}
              showLessItems
              itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
              onChange={(page) => setParams((p) => ({ ...p, page }))}
            />
            <span className="fl-rows">
              {tx('প্রতি পাতায় সারি')}{' '}
              <Select value={params.per_page} className="fl-size" options={[5, 10, 25, 50].map((v) => ({ value: v, label: digits(v) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />
            </span>
          </div>
        </div>

        {detailId && <Details key={detailId} id={detailId} onClose={() => setClosed(true)} />}
      </div>
    </ConfigProvider>
  )
}
