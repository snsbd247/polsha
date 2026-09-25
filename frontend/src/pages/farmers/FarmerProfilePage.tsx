import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, ConfigProvider, Dropdown, Empty, Modal, QRCode, Spin, Table, Tag, Timeline, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CameraFilled,
  CheckCircleFilled,
  DeleteOutlined,
  DollarOutlined,
  DownOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeFilled,
  FileTextOutlined,
  HomeOutlined,
  IdcardFilled,
  PictureFilled,
  PlusOutlined,
  PoweroffOutlined,
  PrinterOutlined,
  QrcodeOutlined,
  RightOutlined,
  UploadOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import FarmerLandsTab from '../../components/FarmerLandsTab'
import ProtectedImage from '../../components/ProtectedImage'
import QrLabel from '../../components/QrLabel'
import { TeamSolid } from '../../components/SideIcons'
import { api, errorMessage } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { useLandMeta } from '../../lib/land'
import { APPLICATION_STATUS, MEMBER_STATUS, openProtectedFile, useFarmerMeta, type MemberStatus } from '../../lib/phase2'
import { qrUrl } from '../../lib/phase8'
import { usePublicSettings } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { DocThumb, DocumentsTab, FundTab, HistoryTab, IrrigationTab, LoansTab, PaymentsTab, UploadDocModal, useDocuments, useRemoveDoc } from './ProfileTabs'
import './farmer-profile.css'

type HistoryRow = { id: number; action: string; from_status: string | null; to_status: string; effective_date: string; reason: string | null; resolution_no: string | null; fee: string | null; creator: { name_bn: string } | null }

type FarmerDetail = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mother_name: string | null
  spouse_name: string | null
  gender: string
  date_of_birth: string | null
  nid: string | null
  birth_reg_no: string | null
  mobile: string | null
  alt_mobile: string | null
  email: string | null
  address: string
  mouza: string | null
  mouza_jl_no: string | null
  post_office: string | null
  post_code: string | null
  blood_group: string | null
  education_level: string | null
  farmer_type: string | null
  family: { id: number; name: string; relation: string | null; occupation: string | null; mobile: string | null }[]
  occupation: string | null
  remarks: string | null
  is_active: boolean
  photo_url: string | null
  household: { id: number; code: string; head: { id: number; name_bn: string } | null } | null
  household_relation: string | null
  member: { id: number; member_no: number; status: MemberStatus } | null
  member_detail: {
    id: number
    member_no: number
    admitted_on: string
    status: MemberStatus
    is_legacy: boolean
    history: HistoryRow[]
    nominees: { id: number; name: string; relation: string; share_percent: string }[]
  } | null
  applications: { id: number; application_no: string; applied_on: string; status: string }[]
  merged_into: { id: number; farmer_code: string; name_bn: string } | null
  pending_application?: boolean
  created_at: string
}

type Fund = { account_id: number | null; account_no: string | null; deposit: number; withdrawal: number; balance: number; shares?: number }
type LandRec = { id: number; land_code: string; mouza: string | null; dag_no: string; khatian_no: string; area_acre: number; land_type: string | null; owner: string; cultivator: string | null; cultivation: string | null }
type Overview = {
  share_unit_price: number
  land: { acre: number; records: LandRec[] } | null
  irrigation: { due: number; season: string | null; amount: number; paid: number; season_due: number } | null
  savings: Fund | null
  share: Fund | null
  loan: { active: number; active_id: number | null; disbursed: number; balance: number } | null
  membership: { admission_fee: number | null; initial_shares: number | null; voter: boolean } | null
}

const ACTION: Record<string, string> = {
  admit: tx('সদস্যপদ অনুমোদন'),
  legacy: tx('পুরোনো খাতা থেকে এন্ট্রি'),
  deactivate: tx('নিষ্ক্রিয়'),
  activate: tx('সক্রিয়'),
  cancel: tx('সদস্যপদ বাতিল'),
  reactivate: tx('পুনর্বহাল'),
}

const num = (n: number) => digits(n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const tk = (n: number | null | undefined) => (n == null ? '—' : '৳ ' + num(n))
const CULT_CLASS: Record<string, string> = { own: 'green', borga: 'gold', lease: 'blue' }
const CULT_LABEL: Record<string, string> = { own: tx('নিজ চাষ'), borga: tx('বর্গা'), lease: tx('লিজ') }

/** "label : value" row used by the information cards. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="fp-row">
      <span className="fp-row-label">{label}</span>
      <span className="fp-row-colon">:</span>
      <span className="fp-row-value">{children ?? '—'}</span>
    </div>
  )
}

function Panel({ icon, title, extra, className, children }: { icon: ReactNode; title: ReactNode; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`fp-card ${className ?? ''}`}>
      <header className="fp-card-head">
        <h3>
          <span className="fp-card-icon">{icon}</span>
          {title}
        </h3>
        {extra}
      </header>
      <div className="fp-card-body">{children}</div>
    </section>
  )
}

function SummaryCard({ icon, title, link, cols }: { icon: ReactNode; title: ReactNode; link?: string | null; cols: { label: string; value: ReactNode; tone?: string }[] }) {
  const navigate = useNavigate()
  return (
    <section className="fp-card fp-sum">
      <header className="fp-card-head">
        <h3>
          <span className="fp-card-icon">{icon}</span>
          {title}
        </h3>
        {link && (
          <Button size="small" className="fp-mini" onClick={() => navigate(link)}>
            {tx('বিস্তারিত দেখুন')}
          </Button>
        )}
      </header>
      <div className="fp-sum-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {cols.map((c) => (
          <span key={c.label} className="fp-sum-label">
            {c.label}
          </span>
        ))}
        {cols.map((c) => (
          <span key={c.label} className={`fp-sum-value ${c.tone ?? ''}`}>
            {c.value}
          </span>
        ))}
      </div>
    </section>
  )
}

export default function FarmerProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const { data: landMeta } = useLandMeta()
  const { data: settings } = usePublicSettings()
  const [tab, setTab] = useState('overview')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const { data: f, isLoading } = useQuery({
    queryKey: ['farmers', id],
    queryFn: async () => (await api.get<FarmerDetail>(`/farmers/${id}`)).data,
  })
  const { data: o } = useQuery({
    queryKey: ['farmers', id, 'overview'],
    queryFn: async () => (await api.get<Overview>(`/farmers/${id}/overview`)).data,
  })
  const docs = useDocuments(Number(id))
  const removeDoc = useRemoveDoc(Number(id))

  if (isLoading || !f) return <Spin />
  const m = f.member_detail
  const unit = o?.share_unit_price ?? 10
  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  const nidDoc = docs.data?.find((d) => d.type === 'nid_front' || d.type === 'nid_back')
  const pendingApp = f.applications.find((a) => a.status === 'pending')
  const latestApp = f.applications[0]
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['farmers', id] })
  const openDoc = (docId: number) => openProtectedFile(`/farmers/${f.id}/documents/${docId}`).catch((e) => message.error(errorMessage(e)))

  const toggleActive = () =>
    modal.confirm({
      title: f.is_active ? tx('কৃষককে নিষ্ক্রিয় করবেন?') : tx('কৃষককে সক্রিয় করবেন?'),
      okText: tx('হ্যাঁ'),
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.post(`/farmers/${f.id}/toggle-active`)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })
  const removeLand = (l: LandRec) =>
    modal.confirm({
      title: tx('জমি {{p0}} মুছবেন?', { p0: l.land_code }),
      okText: tx('মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('না'),
      onOk: async () => {
        try {
          await api.delete(`/lands/${l.id}`)
          refresh()
        } catch (e) {
          message.error(errorMessage(e))
        }
      },
    })

  const statusTag = f.member ? (
    <span className="fp-pill blue">{tx('সদস্যভুক্ত')}</span>
  ) : pendingApp ? (
    <span className="fp-pill gold">{tx('অপেক্ষমাণ')}</span>
  ) : (
    <span className="fp-pill red">{tx('সদস্য নন')}</span>
  )

  const applicationButton =
    latestApp && can('membership.view') ? (
      <Button icon={<TeamSolid />} onClick={() => navigate(`/membership/applications/${(pendingApp ?? latestApp).id}`)}>
        {tx('সদস্য আবেদন')}
      </Button>
    ) : can('membership.create') && !f.member && f.is_active && !f.merged_into ? (
      <Button icon={<UserAddOutlined />} onClick={() => navigate(`/membership/applications/new?farmer=${f.id}`)}>
        {tx('সদস্য আবেদন')}
      </Button>
    ) : null

  const moreItems = [
    { key: 'qr', icon: <QrcodeOutlined />, label: f.member ? tx('সদস্য কার্ড') : tx('QR লেবেল'), onClick: () => setQrOpen(true) },
    can('irrigation.view') && { key: 'statement', icon: <FileTextOutlined />, label: tx('সেচ হিসাব বিবরণী'), onClick: () => navigate(`/irrigation/farmers/${f.id}/statement`) },
    can('payment.create') && { key: 'collect', icon: <DollarOutlined />, label: tx('টাকা আদায়'), onClick: () => navigate(`/payments/collect?farmer_id=${f.id}`) },
    f.household && { key: 'household', icon: <HomeOutlined />, label: tx('খানা') + ' ' + f.household.code, onClick: () => navigate(`/households?open=${f.household!.id}`) },
    can('farmer.edit') && !f.merged_into && { key: 'toggle', icon: <PoweroffOutlined />, label: f.is_active ? tx('নিষ্ক্রিয় করুন') : tx('সক্রিয় করুন'), onClick: toggleActive },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  const stats = [
    o?.land && { key: 'land', icon: 'users', color: '#2563eb', tint: '#e4edfd', label: tx('মোট জমি'), value: <>{num(o.land.acre)} <small>{tx('একর')}</small></> },
    o?.irrigation && { key: 'irr', icon: 'sprout', color: '#1f9d55', tint: '#e3f5ea', label: tx('সেচ বকেয়া'), value: tk(o.irrigation.due), tone: 'red' },
    o?.savings && { key: 'sav', icon: 'piggy', color: '#7c4ddb', tint: '#efe8fd', label: tx('সঞ্চয় স্থিতি'), value: tk(o.savings.balance), tone: 'blue' },
    o?.loan && { key: 'loan', icon: 'handCoins', color: '#f08c00', tint: '#fdf0dc', label: tx('ঋণ স্থিতি'), value: tk(o.loan.balance), tone: 'red' },
  ].filter(Boolean) as { key: string; icon: string; color: string; tint: string; label: string; value: ReactNode; tone?: string }[]

  const landColumns: ColumnsType<LandRec> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => digits(i + 1) },
    { title: tx('জমি আইডি'), dataIndex: 'land_code', render: (v, l) => <Link to={`/lands/${l.id}`}>{v}</Link> },
    { title: tx('মৌজা'), dataIndex: 'mouza' },
    { title: tx('দাগ নং'), dataIndex: 'dag_no', render: (v) => digits(v) },
    { title: tx('খতিয়ান নং'), dataIndex: 'khatian_no', render: (v) => digits(v) },
    { title: tx('আয়তন (একর)'), dataIndex: 'area_acre', render: (v: number) => digits(v.toFixed(2)) },
    { title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v) => v ?? '—' },
    { title: tx('মালিক'), dataIndex: 'owner', render: (v) => v || '—' },
    { title: tx('চাষি'), dataIndex: 'cultivator', render: (v) => v ?? '—' },
    {
      title: tx('অবস্থা'),
      dataIndex: 'cultivation',
      render: (v: string | null) => (v ? <span className={`fp-pill ${CULT_CLASS[v] ?? 'gray'}`}>{CULT_LABEL[v] ?? landMeta?.cultivation_types[v] ?? v}</span> : <span className="fp-pill gray">{tx('চাষ নেই')}</span>),
    },
    {
      title: tx('অ্যাকশন'),
      width: 96,
      render: (_, l) => (
        <span className="fp-icons">
          <Button type="text" size="small" className="blue" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/lands/${l.id}`)} />
          {can('land.edit') && <Button type="text" size="small" className="blue" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} onClick={() => navigate(`/lands/${l.id}/edit`)} />}
          {can('land.delete') && <Button type="text" size="small" className="red" icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => removeLand(l)} />}
        </span>
      ),
    },
  ]

  const personal = (
    <>
      <Row label={tx('পূর্ণ নাম')}>{nameOf(f)}</Row>
      <Row label={tx('পিতার নাম')}>{f.father_name}</Row>
      <Row label={tx('মাতার নাম')}>{f.mother_name}</Row>
      <Row label={tx('NID নম্বর')}>{digits(f.nid) || '—'}</Row>
      <Row label={tx('জন্মতারিখ')}>{f.date_of_birth ? fmtDate(f.date_of_birth) : '—'}</Row>
      <Row label={tx('লিঙ্গ')}>{meta?.genders[f.gender] ?? f.gender}</Row>
      <Row label={tx('মোবাইল নম্বর')}>{digits(f.mobile) || '—'}</Row>
      <Row label={tx('বিকল্প মোবাইল')}>{digits(f.alt_mobile) || '—'}</Row>
      <Row label={tx('ইমেইল')}>{f.email || '—'}</Row>
      <Row label={tx('ঠিকানা')}>
        {f.post_office ? tx('ডাকঘর:') + ' ' + f.post_office + ', ' : ''}
        {f.address}
      </Row>
      <Row label={tx('মৌজা')}>{f.mouza ? f.mouza + (f.mouza_jl_no ? ` (${tx('জেএল নং')}: ${digits(f.mouza_jl_no)})` : '') : '—'}</Row>
      <Row label={tx('পেশা')}>{f.occupation ? meta?.occupations[f.occupation] : '—'}</Row>
      <Row label={tx('জাতীয় পরিচয়পত্রের কপি')}>
        {nidDoc ? (
          <>
            <span className="fp-pill green">
              <CheckCircleFilled /> {tx('আপলোড হয়েছে')}
            </span>
            <Button size="small" className="fp-mini" onClick={() => openDoc(nidDoc.id)}>
              {tx('দেখুন')}
            </Button>
          </>
        ) : (
          <span className="fp-pill gray">{tx('আপলোড হয়নি')}</span>
        )}
      </Row>
    </>
  )

  const membership = m ? (
    <>
      <Row label={tx('সদস্য নং')}>{digits(m.member_no)}</Row>
      <Row label={tx('সদস্যপদের তারিখ')}>{fmtDate(m.admitted_on)}</Row>
      <Row label={tx('সদস্যপদের ধরন')}>{m.is_legacy ? tx('পুরোনো খাতার সদস্য') : tx('সাধারণ সদস্য')}</Row>
      <Row label={tx('ভর্তি ফি')}>{tk(o?.membership?.admission_fee)}</Row>
      <Row label={tx('প্রাথমিক শেয়ার')}>
        {o?.membership?.initial_shares ? tx('{{p0}} ({{p1}} শেয়ার × {{p2}})', { p0: tk(o.membership.initial_shares * unit), p1: digits(o.membership.initial_shares), p2: tk(unit) }) : '—'}
      </Row>
      <Row label={tx('মোট শেয়ার')}>{o?.share ? tx('{{p0}} শেয়ার ({{p1}})', { p0: num(o.share.shares ?? 0), p1: tk(o.share.balance) }) : '—'}</Row>
      <Row label={tx('সদস্যের অবস্থা')}>
        <span className={`fp-pill ${m.status === 'active' ? 'green' : m.status === 'inactive' ? 'orange' : 'red'}`}>{MEMBER_STATUS[m.status].label}</span>
      </Row>
      <Row label={tx('ভোটাধিকার')}>{o?.membership ? (o.membership.voter ? tx('যোগ্য') : tx('অযোগ্য')) : '—'}</Row>
      <Row label={tx('নমিনি')}>{m.nominees.length ? m.nominees.map((n) => `${n.name} (${n.relation}, ${digits(Number(n.share_percent))}%)`).join(', ') : '—'}</Row>
      <Row label={tx('মন্তব্য')}>{f.remarks || '-'}</Row>
    </>
  ) : (
    <div className="fp-empty">
      <Empty description={pendingApp ? tx('সদস্যপদের আবেদন অনুমোদনের অপেক্ষায়') : tx('সদস্য নন')} />
      {f.applications.length > 0 && (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={f.applications}
          columns={[
            { title: tx('আবেদন নং'), dataIndex: 'application_no', render: (v, a) => <Link to={`/membership/applications/${a.id}`}>{v}</Link> },
            { title: tx('তারিখ'), dataIndex: 'applied_on', render: fmtDate },
            { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag color={APPLICATION_STATUS[s]?.color}>{APPLICATION_STATUS[s]?.label}</Tag> },
          ]}
        />
      )}
    </div>
  )

  const docCards = (
    <div className="fp-docs">
      <figure className="fp-doc">
        <div className="fp-thumb">{f.photo_url ? <ProtectedImage url={f.photo_url} size={124} /> : <UserOutlined className="fp-thumb-icon" />}</div>
        <figcaption className="fp-doc-main">{tx('প্রোফাইল ছবি')}</figcaption>
      </figure>
      {(docs.data ?? []).slice(0, 3).map((d) => (
        <figure className="fp-doc" key={d.id}>
          <DocThumb farmerId={f.id} doc={d} />
          <figcaption>
            <span>{meta?.document_types[d.type] ?? d.type}</span>
            <Button type="text" size="small" className="blue" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => openDoc(d.id)} />
            {can('farmer.edit') && <Button type="text" size="small" className="red" icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => removeDoc(d)} />}
          </figcaption>
        </figure>
      ))}
      {docs.data && docs.data.length > 3 && (
        <button type="button" className="fp-more-docs" onClick={() => setTab('documents')}>
          {tx('আরও {{p0}}টি ডকুমেন্ট', { p0: digits(docs.data.length - 3) })}
        </button>
      )}
    </div>
  )

  const overview = (
    <>
      <div className="fp-grid3">
        <Panel
          icon={<UserOutlined />}
          title={tx('ব্যক্তিগত তথ্য')}
          extra={
            can('farmer.edit') && !f.merged_into ? (
              <Button size="small" className="fp-mini" icon={<EditOutlined />} onClick={() => navigate(`/farmers/${f.id}/edit`)}>
                {tx('সম্পাদনা')}
              </Button>
            ) : null
          }
        >
          {personal}
        </Panel>
        <Panel
          icon={<TeamSolid />}
          title={
            <>
              <span className="fp-card-title">{tx('সদস্যপদের তথ্য')}</span>
              {m && <span className={`fp-pill ${m.status === 'active' ? 'green' : 'red'} fp-head-pill`}>{m.status === 'active' ? tx('সক্রিয় সদস্য') : MEMBER_STATUS[m.status].label}</span>}
            </>
          }
          extra={
            m && can('member.edit') ? (
              <Button size="small" className="fp-mini" icon={<EditOutlined />} onClick={() => setTab('membership')}>
                {tx('সম্পাদনা')}
              </Button>
            ) : null
          }
          className="fp-member-card"
        >
          {membership}
        </Panel>
        <Panel
          icon={<PictureFilled />}
          title={<span className="fp-card-title">{tx('ছবি ও ডকুমেন্ট')}</span>}
          extra={
            can('farmer.edit') ? (
              <Button size="small" className="fp-mini" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
                {tx('আপলোড করুন')}
              </Button>
            ) : null
          }
        >
          {docCards}
        </Panel>
      </div>

      {o?.land && (
        <section className="fp-card fp-land">
          <header className="fp-card-head">
            <h3>
              <span className="fp-card-icon">
                <EnvironmentOutlined />
              </span>
              {tx('জমির তথ্য ({{p0}}টি রেকর্ড)', { p0: digits(o.land.records.length) })}
            </h3>
            <span className="fp-head-btns">
              {can('land.create') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/lands/new')}>
                  {tx('জমি যোগ করুন')}
                </Button>
              )}
              <Button icon={<EnvironmentOutlined />} className="fp-blue-btn" onClick={() => setTab('land')}>
                {tx('জমি ও চাষের বিস্তারিত')}
              </Button>
            </span>
          </header>
          <Table<LandRec> className="fp-table" rowKey="id" size="small" dataSource={o.land.records} pagination={false} scroll={{ x: 1000 }} columns={landColumns} locale={{ emptyText: tx('কোনো জমি নেই') }} />
        </section>
      )}

      <div className="fp-grid4">
        {o?.irrigation && (
          <SummaryCard
            icon={<DashIcon name="drop" size={18} color="#2563eb" stroke={2.2} />}
            title={<span className="fp-card-title" title={o.irrigation.season ?? undefined}>{tx('সেচ সারাংশ (চলতি মৌসুম)')}</span>}
            link={`/irrigation/farmers/${f.id}/statement`}
            cols={[
              { label: tx('মোট ইনভয়েস'), value: tk(o.irrigation.amount) },
              { label: tx('পরিশোধিত'), value: tk(o.irrigation.paid), tone: 'green' },
              { label: tx('বকেয়া'), value: tk(o.irrigation.season_due), tone: 'red' },
            ]}
          />
        )}
        {o?.savings && (
          <SummaryCard
            icon={<DashIcon name="piggy" size={18} color="#2563eb" stroke={2.2} />}
            title={tx('সঞ্চয় সারাংশ')}
            link={o.savings.account_id ? `/funds/savings/accounts/${o.savings.account_id}` : null}
            cols={[
              { label: tx('মোট সঞ্চয় জমা'), value: tk(o.savings.deposit) },
              { label: tx('মোট উত্তোলন'), value: tk(o.savings.withdrawal) },
              { label: tx('স্থিতি'), value: tk(o.savings.balance), tone: 'blue' },
            ]}
          />
        )}
        {o?.loan && (
          <SummaryCard
            icon={<DashIcon name="handCoins" size={18} color="#2563eb" stroke={2.2} />}
            title={tx('ঋণ সারাংশ')}
            link={o.loan.active_id ? `/loans/${o.loan.active_id}` : null}
            cols={[
              { label: tx('সক্রিয় ঋণ'), value: digits(o.loan.active) },
              { label: tx('মোট বিতরণ'), value: tk(o.loan.disbursed) },
              { label: tx('স্থিতি'), value: tk(o.loan.balance), tone: 'red' },
            ]}
          />
        )}
        {o?.share && (
          <SummaryCard
            icon={<DashIcon name="bars" size={18} color="#2563eb" stroke={2.4} />}
            title={tx('শেয়ার সারাংশ')}
            link={o.share.account_id ? `/funds/share/accounts/${o.share.account_id}` : null}
            cols={[
              { label: tx('মোট শেয়ার'), value: num(o.share.shares ?? 0) },
              { label: tx('শেয়ার মূল্য'), value: tk(unit) },
              { label: tx('মোট টাকা'), value: tk(o.share.balance) },
            ]}
          />
        )}
      </div>
    </>
  )

  const tabs = [
    { key: 'overview', label: tx('ওভারভিউ') },
    { key: 'personal', label: tx('ব্যক্তিগত তথ্য') },
    { key: 'membership', label: tx('সদস্যপদ') },
    can('land.view') && { key: 'land', label: tx('জমি ও চাষ') },
    can('irrigation.view') && { key: 'irrigation', label: tx('সেচ') },
    can('savings.view') && { key: 'savings', label: tx('সঞ্চয়') },
    can('loan.view') && { key: 'loans', label: tx('ঋণ') },
    can('share.view') && { key: 'share', label: tx('শেয়ার') },
    can('payment.view') && { key: 'payments', label: tx('পেমেন্ট') },
    { key: 'documents', label: tx('ডকুমেন্ট') },
    { key: 'history', label: tx('ইতিহাস') },
  ].filter(Boolean) as { key: string; label: string }[]

  const body: Record<string, ReactNode> = {
    overview,
    personal: (
      <div className="fp-grid2">
        <Panel icon={<UserOutlined />} title={tx('ব্যক্তিগত তথ্য')}>
          {personal}
        </Panel>
        <Panel icon={<IdcardFilled />} title={tx('অন্যান্য তথ্য')}>
          <Row label={tx('নাম (English)')}>{f.name_en || '—'}</Row>
          <Row label={tx('স্বামী/স্ত্রী')}>{f.spouse_name}</Row>
          <Row label={tx('জন্ম নিবন্ধন')}>{digits(f.birth_reg_no) || '—'}</Row>
          <Row label={tx('পোস্ট কোড')}>{digits(f.post_code) || '—'}</Row>
          <Row label={tx('রক্তের গ্রুপ')}>{f.blood_group ? meta?.blood_groups[f.blood_group] ?? f.blood_group : '—'}</Row>
          <Row label={tx('শিক্ষাগত যোগ্যতা')}>{f.education_level ? meta?.education_levels[f.education_level] : '—'}</Row>
          <Row label={tx('কৃষকের ধরন')}>{f.farmer_type ? meta?.farmer_types[f.farmer_type] : '—'}</Row>
          <Row label={tx('পরিবারের সদস্য')}>
            {f.family?.length
              ? f.family.map((m) => [m.name, m.relation ? meta?.relations[m.relation] : null, m.occupation, m.mobile ? digits(m.mobile) : null].filter(Boolean).join(' · ')).join('; ')
              : '—'}
          </Row>
          <Row label={tx('খানা')}>{f.household ? <Link to={`/households?open=${f.household.id}`}>{f.household.code}</Link> : '—'}</Row>
          <Row label={tx('খানাপ্রধান')}>{f.household?.head?.name_bn}</Row>
          <Row label={tx('সম্পর্ক')}>{f.household_relation ? meta?.relations[f.household_relation] : '—'}</Row>
          <Row label={tx('মন্তব্য')}>{f.remarks}</Row>
          <Row label={tx('নিবন্ধন')}>{fmtDateTime(f.created_at)}</Row>
        </Panel>
      </div>
    ),
    membership: (
      <div className="fp-grid2">
        <Panel icon={<TeamSolid />} title={tx('সদস্যপদের তথ্য')}>
          {membership}
        </Panel>
        <Panel icon={<FileTextOutlined />} title={tx('সদস্যপদের ইতিহাস')}>
          {m && m.history.length ? (
            <Timeline
              className="fp-timeline"
              items={m.history.map((h) => ({
                color: h.to_status === 'active' ? 'green' : h.to_status === 'cancelled' ? 'red' : 'orange',
                content: (
                  <>
                    <strong>{ACTION[h.action] ?? h.action}</strong>
                    {' '}{tx('· কার্যকর')}{' '}{fmtDate(h.effective_date)}
                    {h.reason && <div>{tx('কারণ:')}{' '}{h.reason}</div>}
                    {h.resolution_no && <div>{tx('সভার সিদ্ধান্ত:')}{' '}{h.resolution_no}</div>}
                    {h.fee && Number(h.fee) > 0 && <div>{tx('ফি: ৳')}{' '}{digits(Number(h.fee))}</div>}
                    {h.creator && <Typography.Text type="secondary">{h.creator.name_bn}</Typography.Text>}
                  </>
                ),
              }))}
            />
          ) : (
            <Empty description={tx('কোনো ইতিহাস নেই')} />
          )}
        </Panel>
      </div>
    ),
    land: <section className="fp-card fp-pad"><FarmerLandsTab farmerId={f.id} /></section>,
    irrigation: <section className="fp-card fp-pad"><IrrigationTab farmerId={f.id} /></section>,
    savings: <section className="fp-card fp-pad"><FundTab kind="savings" accountId={o?.savings?.account_id} /></section>,
    share: <section className="fp-card fp-pad"><FundTab kind="share" accountId={o?.share?.account_id} /></section>,
    loans: <section className="fp-card fp-pad"><LoansTab memberId={f.member?.id} /></section>,
    payments: <section className="fp-card fp-pad"><PaymentsTab farmerId={f.id} /></section>,
    documents: <section className="fp-card fp-pad"><DocumentsTab farmerId={f.id} /></section>,
    history: <section className="fp-card fp-pad"><HistoryTab farmerId={f.id} /></section>,
  }

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fp">
        <div className="fp-top">
          <nav className="fp-crumb">
            <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
              <HomeOutlined />
            </Link>
            <RightOutlined className="fp-crumb-sep" />
            <Link to="/farmers">{tx('কৃষক')}</Link>
            <RightOutlined className="fp-crumb-sep" />
            <span>{tx('কৃষকের প্রোফাইল')}</span>
          </nav>
          <div className="fp-top-btns no-print">
            {can('farmer.edit') && !f.merged_into && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/farmers/${f.id}/edit`)}>
                {tx('সম্পাদনা')}
              </Button>
            )}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              {tx('প্রিন্ট')}
            </Button>
            {applicationButton}
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button>
                {tx('আরও')} <DownOutlined className="fp-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        {f.merged_into && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            title={
              <>
                {tx('এই রেকর্ডটি')}{' '}<Link to={`/farmers/${f.merged_into.id}`}>{f.merged_into.farmer_code} ({f.merged_into.name_bn})</Link>{tx('-এর সাথে মার্জ করা হয়েছে।')}
              </>
            }
          />
        )}

        <section className="fp-card fp-hero">
          <div className="fp-photo">
            {f.photo_url ? <ProtectedImage url={f.photo_url} size={183} /> : <UserOutlined className="fp-photo-empty" />}
            {can('farmer.edit') && !f.merged_into && (
              <button type="button" className="fp-camera no-print" aria-label={tx('ছবি পরিবর্তন')} onClick={() => navigate(`/farmers/${f.id}/edit`)}>
                <CameraFilled />
              </button>
            )}
          </div>
          <div className="fp-ident">
            <div className="fp-name">
              <h1>{nameOf(f)}</h1>
              <span className={`fp-pill solid ${f.is_active ? 'green' : 'red'}`}>{f.is_active ? tx('সক্রিয় কৃষক') : tx('নিষ্ক্রিয় কৃষক')}</span>
              {statusTag}
            </div>
            <div className="fp-ident-grid">
              <div className="fp-kv strong">
                <span>{tx('কৃষক আইডি')}</span>
                <span>:</span>
                <span>{f.farmer_code}</span>
              </div>
              <div className="fp-kv strong">
                <span>{tx('সদস্য নং')}</span>
                <span>:</span>
                <span>{f.member ? digits(f.member.member_no) : '—'}</span>
              </div>
              <button type="button" className="fp-qr" onClick={() => setQrOpen(true)} aria-label={tx('QR লেবেল')}>
                <QRCode value={qrUrl('farmer', f.farmer_code)} size={48} bordered={false} type="svg" />
              </button>
              <div className="fp-kv">
                <span>{tx('মোবাইল')}</span>
                <span>:</span>
                <span>{digits(f.mobile) || '—'}</span>
              </div>
              <div className="fp-kv">
                <span>NID</span>
                <span>:</span>
                <span>{digits(f.nid) || '—'}</span>
              </div>
              <div className="fp-kv">
                <span>{tx('পিতার নাম')}</span>
                <span>:</span>
                <span>{f.father_name}</span>
              </div>
            </div>
          </div>
          {stats.length > 0 && (
            <div className="fp-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
              {stats.map((s) => (
                <div key={s.key} className="fp-stat" style={{ ['--tint' as string]: s.tint }}>
                  <span className="fp-stat-icon" style={{ background: s.tint }}>
                    <DashIcon name={s.icon} size={22} color={s.color} stroke={1.9} />
                  </span>
                  <span className="fp-stat-label">{s.label}</span>
                  <span className={`fp-stat-value ${s.tone ?? ''}`}>{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <nav className="fp-tabs no-print" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        {body[tab]}

        <UploadDocModal farmerId={f.id} open={uploadOpen} onClose={() => setUploadOpen(false)} />
        <Modal open={qrOpen} onCancel={() => setQrOpen(false)} footer={null} width={290} title={f.member ? tx('সদস্য কার্ড') : tx('QR লেবেল')}>
          <QrLabel
            type="farmer"
            code={f.farmer_code}
            title={nameOf(f)}
            subtitle={f.member ? tx('সদস্য নং') + ' ' + digits(f.member.member_no) : undefined}
            heading={f.member ? society : undefined}
            note={f.member ? settings?.member_card_note || undefined : undefined}
          />
        </Modal>
      </div>
    </ConfigProvider>
  )
}
