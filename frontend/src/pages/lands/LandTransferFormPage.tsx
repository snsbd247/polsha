import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, ConfigProvider, DatePicker, Form, Input, InputNumber, Radio, Select, Spin, Table, Tag, Upload } from 'antd'
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EyeFilled,
  FileImageFilled,
  FilePdfFilled,
  HomeOutlined,
  RightOutlined,
  SaveFilled,
  SearchOutlined,
  SendOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import ProtectedImage from '../../components/ProtectedImage'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { useLandMeta, type LandRow } from '../../lib/land'
import { nameOf, t as tx } from '../../lib/i18n'
import { appPath } from '../../lib/phase8'
import { DashIcon } from '../dashboard/DashIcons'
import { PlotSketch } from './LandDetailPage'
import { TRANSFER_STATUS } from './LandTransferPage'
import './land-form.css'
import './land-transfer-form.css'
import PageTabs from '../../components/PageTabs'

type Card = { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null; nid: string | null; member_no: number | null; address: string; photo_url: string | null }
type LandDetail = LandRow & {
  location: string
  remarks: string | null
  latitude: number | null
  longitude: number | null
  irrigable_decimal: number | null
  owner_cards: (Card & { share_percent: number })[]
}
type Farmer = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  mobile: string | null
  nid: string | null
  photo_url: string | null
  member: { member_no: number } | null
  village: string | null
  mouza: string | null
}
type Transfer = {
  id: number
  approval_request_id: number | null
  transfer_no: string
  land_id: number
  from_farmer_id: number
  to_farmer_id: number
  type: string
  share_percent: number
  reason: string
  transfer_date: string
  amount: number | null
  remarks: string | null
  status: string
}
type Pending = { key: string; file: File; type: string }

const SQFT_PER_DECIMAL = 435.6
const acres = (d: number) => digits((d / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

function Section({ icon, title, children, extra }: { icon: string; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="lf-card">
      <header className="lf-card-head">
        <DashIcon name={icon} size={20} color="#1769e0" stroke={2.2} />
        <h3>{title}</h3>
        {extra && <span className="lt-head-extra">{extra}</span>}
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

function Photo({ url, name, size = 64 }: { url: string | null; name: string; size?: number }) {
  return url ? (
    <ProtectedImage url={url} size={size} shape="square" />
  ) : (
    <span className="lt-initials" style={{ width: size, height: size }}>
      {initials(name)}
    </span>
  )
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="lt-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <span>:</span>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Hand a plot (or part of it) from one owner to another; saved as a draft or sent for approval. */
export default function LandTransferFormPage() {
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const { id: routeId } = useParams()
  // /lands/transfers/:id opens a saved transfer (draft to edit, or the record of a sent one)
  const draftId = routeId ?? sp.get('draft')
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useLandMeta()
  const [form] = Form.useForm()
  const [landQ, setLandQ] = useState(sp.get('land_code') ?? '')
  const [matches, setMatches] = useState<LandRow[] | null>(null)
  const [landId, setLandId] = useState<number | null>(sp.get('land_id') ? Number(sp.get('land_id')) : null)
  const [ownerKind, setOwnerKind] = useState<'existing' | 'new'>('existing')
  const [pending, setPending] = useState<Pending[]>([])
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null)

  const tMeta = useQuery({ queryKey: ['land-transfer-meta'], queryFn: async () => (await api.get<{ types: Record<string, string>; reasons: Record<string, string> }>('/land-transfers/meta')).data })
  const draft = useQuery({ queryKey: ['land-transfers', draftId], queryFn: async () => (await api.get<Transfer>(`/land-transfers/${draftId}`)).data, enabled: !!draftId })
  const land = useQuery({ queryKey: ['lands', String(landId)], queryFn: async () => (await api.get<LandDetail>(`/lands/${landId}`)).data, enabled: !!landId })

  // an existing draft fills the form once
  useEffect(() => {
    const d = draft.data
    if (!d) return
    setLandId(d.land_id)
    form.setFieldsValue({ ...d, transfer_date: dayjs(d.transfer_date) })
  }, [draft.data, form])

  const fromId: number | undefined = Form.useWatch('from_farmer_id', form)
  const toId: number | undefined = Form.useWatch('to_farmer_id', form)
  const type: string | undefined = Form.useWatch('type', form)
  const share: number | undefined = Form.useWatch('share_percent', form)
  const reason: string | undefined = Form.useWatch('reason', form)
  const date: Dayjs | undefined = Form.useWatch('transfer_date', form)

  const l = land.data
  const owners = useMemo(() => l?.owner_cards ?? [], [l])
  useEffect(() => {
    if (l) setLandQ((q) => q || l.land_code)
  }, [l])
  // the only owner is the seller unless there are several to choose from
  useEffect(() => {
    if (owners.length && !owners.some((o) => o.id === form.getFieldValue('from_farmer_id'))) form.setFieldValue('from_farmer_id', owners[0].id)
  }, [owners, form])
  const from = owners.find((o) => o.id === fromId) ?? null
  const to = useQuery({ queryKey: ['farmers', toId, 'card'], queryFn: async () => (await api.get<Farmer>(`/farmers/${toId}`)).data, enabled: !!toId })

  const findLand = async () => {
    if (!landQ.trim()) return
    try {
      const r = await api.get<Paginated<LandRow>>('/lands', { params: { search: landQ.trim(), per_page: 10 } })
      const exact = r.data.data.find((x) => x.land_code.toLowerCase() === landQ.trim().toLowerCase())
      if (exact || r.data.data.length === 1) {
        setLandId((exact ?? r.data.data[0]).id)
        setMatches(null)
      } else setMatches(r.data.data)
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const steps = [
    { title: tx('কোন মালিক'), sub: tx('জমি ও এখনকার মালিক'), done: !!l && !!from },
    { title: tx('কাকে'), sub: tx('নতুন মালিক'), done: !!toId },
    { title: tx('কত অংশ ও তারিখ'), sub: tx('বিবরণ, দলিল, জমা'), done: !!(type && reason && date && (type === 'full' || share)) },
  ]
  // one step on screen at a time; a sent or approved transfer is shown whole
  const [step, setStep] = useState(0)
  const next = async () => {
    if (step === 0 && (!l || !from)) {
      message.error(l ? tx('কোন মালিক হস্তান্তর করছেন বাছাই করুন।') : tx('আগে জমি বাছাই করুন।'))
      return
    }
    if (step === 1) {
      try {
        await form.validateFields(['to_farmer_id'])
      } catch {
        return
      }
    }
    setStep((x) => Math.min(2, x + 1))
  }
  const transferShare = type === 'full' ? from?.share_percent : share
  const transferArea = l && transferShare ? (l.area_decimal * transferShare) / 100 : 0

  const save = async (submit: boolean) => {
    const v = await form.validateFields()
    if (!landId) {
      message.error(tx('আগে জমি বাছাই করুন।'))
      return
    }
    setSaving(submit ? 'submit' : 'draft')
    const payload = { ...v, land_id: landId, transfer_date: (v.transfer_date as Dayjs).format('YYYY-MM-DD'), submit }
    try {
      const r = draftId ? await api.put(`/land-transfers/${draftId}`, payload) : await api.post('/land-transfers', payload)
      // papers go with the plot's records
      const failed: string[] = []
      for (const d of pending) {
        const fd = new FormData()
        fd.append('type', d.type)
        fd.append('title', `${r.data.transfer_no} — ${meta?.document_types[d.type] ?? d.type}`)
        fd.append('file', d.file)
        await api.post(`/lands/${landId}/documents`, fd).catch(() => failed.push(d.file.name))
      }
      if (failed.length) message.warning(tx('হস্তান্তর সংরক্ষণ হয়েছে, কিন্তু এই ফাইলগুলো ওঠেনি: {{p0}}', { p0: failed.join(', ') }))
      else message.success(r.data.message)
      queryClient.invalidateQueries({ queryKey: ['land-transfers'] })
      queryClient.invalidateQueries({ queryKey: ['lands'] })
      if (!submit) navigate(`/lands/transfers/${r.data.id}`, { replace: true })
      else navigate(r.data.status === 'approved' ? `/lands/${landId}?tab=ownership` : `/approvals/${r.data.approval_id}`)
      setPending([])
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(null)
    }
  }

  const docRows = pending.map((p) => ({ key: p.key, pending: p }))
  const locked = draft.data && !['draft', 'rejected'].includes(draft.data.status)

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="lf lt">
        <nav className="lf-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="lf-crumb-sep" />
          <Link to="/lands">{tx('জমি ব্যবস্থাপনা')}</Link>
          <RightOutlined className="lf-crumb-sep" />
          <Link to="/lands/transfers">{tx('জমি হস্তান্তর')}</Link>
          <RightOutlined className="lf-crumb-sep" />
          <span>{draft.data ? draft.data.transfer_no : tx('নতুন জমি হস্তান্তর')}</span>
        </nav>
        <PageTabs />

        <div className="lf-head">
          <div>
            <h1>
              {tx('জমি হস্তান্তর')} {draft.data && <Tag className="lt-no">{draft.data.transfer_no}</Tag>}
              {draft.data && <Tag className={`fl-tag lt-no ${TRANSFER_STATUS[draft.data.status as keyof typeof TRANSFER_STATUS]?.[1] ?? ''}`}>{TRANSFER_STATUS[draft.data.status as keyof typeof TRANSFER_STATUS]?.[0]}</Tag>}
            </h1>
            <p>{tx('এক মালিকের কাছ থেকে আরেকজনের কাছে জমির মালিকানা হস্তান্তর করুন। নিচের তথ্য পূরণ করে অনুমোদনের জন্য পাঠান।')}</p>
          </div>
          {draft.data && (
            <span className="lt-badges">
              <Tag className="lt-no">{draft.data.transfer_no}</Tag>
              <Tag className={`fl-tag lt-no ${TRANSFER_STATUS[draft.data.status as keyof typeof TRANSFER_STATUS]?.[1] ?? ''}`}>{TRANSFER_STATUS[draft.data.status as keyof typeof TRANSFER_STATUS]?.[0]}</Tag>
            </span>
          )}
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/lands/transfers')}>
            {tx('হস্তান্তরের তালিকায় ফিরুন')}
          </Button>
        </div>

        <div className="lt-steps lt-steps-3">
          {steps.map((s, i) => (
            <div key={s.title} className={`lt-step ${i === step ? 'on' : ''} ${s.done && (locked || i < step) ? 'done' : ''}`} onClick={() => (locked || i <= step || steps.slice(0, i).every((x) => x.done)) && setStep(i)}>
              <span className="lt-step-no">{digits(i + 1)}</span>
              <span>
                <b>{s.title}</b>
                <small>{s.sub}</small>
              </span>
            </div>
          ))}
        </div>

        {locked && (
          <Alert
            className="lt-alert"
            type={draft.data?.status === 'approved' ? 'success' : 'info'}
            showIcon
            title={draft.data?.status === 'approved' ? tx('এই হস্তান্তর অনুমোদিত ও কার্যকর হয়েছে।') : tx('এই হস্তান্তর আগেই অনুমোদনের জন্য পাঠানো হয়েছে; আর বদলানো যায় না।')}
            action={draft.data?.approval_request_id ? <Link to={`/approvals/${draft.data.approval_request_id}`}>{tx('অনুমোদন দেখুন')}</Link> : undefined}
          />
        )}

        <Form form={form} layout="vertical" className="lf-form" disabled={!!locked} initialValues={{ type: 'full', reason: 'sale', transfer_date: dayjs() }}>
          <div className="lt-grid">
            <div className="lt-main">
              <div hidden={!locked && step !== 0}>
                <Section icon="sprout" title={tx('জমির মূল তথ্য')}>
                  <div className="lt-land-top">
                    <div className="lt-find">
                      <label>
                        {tx('জমি খুঁজুন')}
                        <span className="lf-req">*</span>
                      </label>
                      <div className="lt-find-row">
                        <Input value={landQ} placeholder={tx('জমির নং, দাগ বা মালিকের নাম')} onChange={(e) => setLandQ(e.target.value)} onPressEnter={findLand} />
                        <Button type="primary" icon={<SearchOutlined />} onClick={findLand}>
                          {tx('খুঁজুন')}
                        </Button>
                      </div>
                      {matches && (
                        <div className="lt-matches">
                          {matches.length ? (
                            matches.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setLandId(m.id)
                                  setLandQ(m.land_code)
                                  setMatches(null)
                                }}
                              >
                                <strong>{m.land_code}</strong> {m.mouza} · {tx('দাগ')} {digits(m.dag_no)} · {m.owners.map((o) => o.name_bn).join(', ')}
                              </button>
                            ))
                          ) : (
                            <div className="lt-nomatch">{tx('কোনো জমি পাওয়া যায়নি')}</div>
                          )}
                        </div>
                      )}
                    </div>
                    {[
                      [tx('জমির নং'), l?.land_code],
                      [tx('মৌজা'), l?.mouza],
                      [tx('দাগ নং'), l && digits(l.dag_no)],
                      [tx('খতিয়ান নং'), l && digits(l.khatian_no)],
                    ].map(([k, v]) => (
                      <div key={k as string} className="lt-ro">
                        <label>{k}</label>
                        <Input disabled value={(v as string) ?? ''} />
                      </div>
                    ))}
                  </div>
                  {land.isFetching && <Spin />}
                  {l && (
                    <div className="lt-land-detail">
                      <KV
                        rows={[
                          [tx('জমির ধরন'), l.land_type ? <Tag className="fl-tag ll-green">{l.land_type}</Tag> : '—'],
                          [tx('মোট পরিমাণ'), tx('{{p0}} একর ({{p1}} বর্গফুট)', { p0: acres(l.area_decimal), p1: digits(Math.round(l.area_decimal * SQFT_PER_DECIMAL).toLocaleString('en-IN')) })],
                          [tx('সেচকৃত জমি'), l.irrigable_decimal != null ? tx('{{p0}} একর', { p0: acres(l.irrigable_decimal) }) : '—'],
                          [tx('সেচহীন জমি'), l.irrigable_decimal != null ? tx('{{p0}} একর', { p0: acres(Math.max(0, l.area_decimal - l.irrigable_decimal)) }) : '—'],
                        ]}
                      />
                      <KV
                        rows={[
                          [tx('অবস্থান'), l.location || '—'],
                          [tx('মালিকানার ধরন'), owners.length > 1 ? tx('যৌথ ({{p0}} জন)', { p0: digits(owners.length) }) : tx('একক')],
                          [tx('বর্তমান অবস্থা'), <Tag className="fl-tag fl-tag-green">{meta?.statuses[l.status] ?? l.status}</Tag>],
                          [tx('মন্তব্য'), l.remarks || '—'],
                        ]}
                      />
                      <div className="lt-sketch">
                        <PlotSketch land={l} />
                      </div>
                    </div>
                  )}
                </Section>

                <Section icon="users" title={tx('বর্তমান মালিকের তথ্য')}>
                  {!l ? (
                    <div className="lt-empty">{tx('আগে জমি বাছাই করুন।')}</div>
                  ) : !owners.length ? (
                    <Alert type="warning" showIcon title={tx('এই জমির কোনো মালিক নেই।')} />
                  ) : (
                    <>
                      {owners.length > 1 && (
                        <Form.Item name="from_farmer_id" label={tx('কোন মালিক হস্তান্তর করছেন?')} className="lt-pick-owner">
                          <Radio.Group options={owners.map((o) => ({ value: o.id, label: `${nameOf(o)} (${digits(o.share_percent)}%)` }))} />
                        </Form.Item>
                      )}
                      {owners.length === 1 && (
                        <Form.Item name="from_farmer_id" hidden>
                          <Input />
                        </Form.Item>
                      )}
                      {from && (
                        <div className="lt-person">
                          <Photo url={from.photo_url} name={nameOf(from)} size={60} />
                          <div className="lt-person-main">
                            <div className="lt-person-name">
                              <Link to={`/farmers/${from.id}`}>{nameOf(from)}</Link>
                              <Tag className="fl-tag ll-blue">{tx('এখনকার মালিক')}</Tag>
                              {owners.length > 1 && <span className="lt-muted">{tx('অংশ {{p0}}%', { p0: digits(from.share_percent) })}</span>}
                            </div>
                            <KV
                              rows={[
                                [tx('সদস্য নং'), from.member_no ? digits(from.member_no) : tx('সদস্য নন')],
                                [tx('মোবাইল'), digits(from.mobile ?? '') || '—'],
                              ]}
                            />
                          </div>
                          <KV
                            rows={[
                              ['NID', digits(from.nid ?? '') || '—'],
                              [tx('ঠিকানা'), from.address || '—'],
                            ]}
                          />
                        </div>
                      )}
                    </>
                  )}
                </Section>
              </div>
              <div hidden={!locked && step !== 1}>
                <Section icon="userPlus" title={tx('নতুন মালিকের তথ্য')}>
                  <div className="lt-new-owner">
                    <div className="lt-new-left">
                      <Radio.Group
                        value={ownerKind}
                        onChange={(e) => setOwnerKind(e.target.value)}
                        options={[
                          { value: 'existing', label: tx('আগে থেকে নিবন্ধিত') },
                          { value: 'new', label: tx('নতুন কৃষক (তৈরি করুন)') },
                        ]}
                      />
                      {ownerKind === 'existing' ? (
                        <Form.Item name="to_farmer_id" label={tx('কৃষক / সদস্য খুঁজুন')} rules={[{ required: true, message: tx('নতুন মালিক বাছাই করুন') }]}>
                          <FarmerPicker placeholder={tx('নাম, কৃষক নং বা সদস্য নং')} exclude={fromId ? [fromId] : []} initialLabel={to.data ? `${nameOf(to.data)} (${to.data.farmer_code})` : undefined} />
                        </Form.Item>
                      ) : (
                        <div className="lt-new-help">
                          <p>{tx('নতুন কৃষককে আগে নিবন্ধন করুন, তারপর এখানে "নিবন্ধিত কৃষক" থেকে খুঁজে নিন। এই ফর্মের তথ্য হারাবে না — কৃষক ফর্মটি নতুন ট্যাবে খুলবে।')}</p>
                          <Button icon={<UserAddOutlined />} onClick={() => window.open(appPath('/farmers/new'), '_blank', 'noopener')}>
                            {tx('নতুন কৃষক যোগ করুন')}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="lt-new-right">
                      {to.data ? (
                        <div className="lt-person">
                          <Photo url={to.data.photo_url} name={nameOf(to.data)} size={60} />
                          <div className="lt-person-main">
                            <div className="lt-person-name">
                              <Link to={`/farmers/${to.data.id}`}>{nameOf(to.data)}</Link>
                              <Tag className="fl-tag ll-green">{tx('নতুন মালিক')}</Tag>
                            </div>
                            <KV
                              rows={[
                                [tx('সদস্য নং'), to.data.member ? digits(to.data.member.member_no) : tx('সদস্য নন')],
                                [tx('মোবাইল'), digits(to.data.mobile ?? '') || '—'],
                              ]}
                            />
                          </div>
                          <KV
                            rows={[
                              ['NID', digits(to.data.nid ?? '') || '—'],
                              [tx('ঠিকানা'), [to.data.village, to.data.mouza].filter(Boolean).join(', ') || '—'],
                            ]}
                          />
                        </div>
                      ) : (
                        <div className="lt-empty">{tx('এখনো কাউকে বাছাই করা হয়নি')}</div>
                      )}
                    </div>
                  </div>
                </Section>
              </div>
              <div hidden={!locked && step !== 2}>
                <Section icon="file" title={tx('হস্তান্তরের বিবরণ')}>
                  <div className="lt-details">
                    <Form.Item name="type" label={tx('হস্তান্তরের ধরন')} rules={[{ required: true }]}>
                      <Select options={Object.entries(tMeta.data?.types ?? {}).map(([value, label]) => ({ value, label }))} />
                    </Form.Item>
                    {type === 'partial' && (
                      <Form.Item
                        name="share_percent"
                        label={tx('হস্তান্তরিত অংশ (%)')}
                        rules={[{ required: true, message: tx('অংশ দিন') }, { validator: (_, v) => (!v || !from || v <= from.share_percent ? Promise.resolve() : Promise.reject(new Error(tx('মালিকের অংশের বেশি হতে পারে না')))) }]}
                      >
                        <InputNumber min={0.01} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    )}
                    <Form.Item name="transfer_date" label={tx('হস্তান্তরের তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                      <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                    </Form.Item>
                    <Form.Item name="reason" label={tx('হস্তান্তরের কারণ')} rules={[{ required: true }]}>
                      <Select options={Object.entries(tMeta.data?.reasons ?? {}).map(([value, label]) => ({ value, label }))} />
                    </Form.Item>
                    <Form.Item name="amount" label={tx('চুক্তির টাকা (৳)')}>
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="remarks" label={tx('মন্তব্য')}>
                      <Input maxLength={500} placeholder={tx('যেমন: দলিল নং ১২৩৪')} />
                    </Form.Item>
                  </div>
                </Section>

                <Section icon="file" title={tx('ডকুমেন্ট আপলোড')}>
                  <div className="lf-docs">
                    <Upload.Dragger
                      multiple
                      showUploadList={false}
                      accept=".pdf,.jpg,.jpeg,.png"
                      disabled={!!locked}
                      beforeUpload={(file, list) => {
                        if (file === list[0]) {
                          const ok = (list as unknown as File[]).filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.name) && f.size <= 5 * 1024 * 1024)
                          if (ok.length < list.length) message.warning(tx('শুধু PDF, JPG বা PNG, প্রতিটি সর্বোচ্চ ৫ MB।'))
                          setPending((p) => [...p, ...ok.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, file: f, type: 'deed' }))])
                        }
                        return false
                      }}
                      className="lf-drop"
                    >
                      <CloudUploadOutlined className="lf-drop-icon" />
                      <p>
                        {tx('ফাইল এখানে টেনে আনুন অথবা')} <a>{tx('ক্লিক করে আপলোড করুন')}</a>
                      </p>
                      <small>{tx('PDF, JPG, PNG (প্রতিটি সর্বোচ্চ ৫ MB)')}</small>
                    </Upload.Dragger>
                    <Table
                      className="lf-doc-table"
                      size="small"
                      rowKey="key"
                      pagination={false}
                      dataSource={docRows}
                      locale={{ emptyText: tx('কোনো ডকুমেন্ট নেই') }}
                      columns={[
                        { title: '#', width: 30, render: (_, __, i) => digits(i + 1) },
                        {
                          title: tx('ডকুমেন্টের নাম'),
                          render: (_, r) => (
                            <Select
                              size="small"
                              className="lf-doc-type"
                              value={r.pending.type}
                              options={Object.entries(meta?.document_types ?? {}).map(([value, label]) => ({ value, label }))}
                              onChange={(t) => setPending((p) => p.map((x) => (x.key === r.key ? { ...x, type: t } : x)))}
                            />
                          ),
                        },
                        { title: tx('ফাইল'), width: 44, align: 'center', render: (_, r) => (r.pending.file.type.includes('pdf') ? <FilePdfFilled className="lf-pdf" /> : <FileImageFilled className="lf-img" />) },
                        { title: tx('আপলোডের তারিখ'), width: 96, render: () => fmtDate(dayjs().format('YYYY-MM-DD')) },
                        {
                          title: tx('অ্যাকশন'),
                          width: 70,
                          align: 'center',
                          render: (_, r) => (
                            <span className="lf-doc-actions">
                              <Button type="text" size="small" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => window.open(URL.createObjectURL(r.pending.file), '_blank', 'noopener')} />
                              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => setPending((p) => p.filter((x) => x.key !== r.key))} />
                            </span>
                          ),
                        },
                      ]}
                    />
                  </div>
                </Section>
              </div>
              {!locked && (
                <div className="lt-step-nav">
                  {step > 0 && (
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setStep((x) => x - 1)}>
                      {tx('আগের ধাপ')}
                    </Button>
                  )}
                  <span className="lt-step-gap" />
                  {step < 2 && (
                    <Button type="primary" onClick={next}>
                      {tx('পরের ধাপ')} <ArrowRightOutlined />
                    </Button>
                  )}
                </div>
              )}
            </div>

            <aside className="lt-side">
              <Section icon="file" title={tx('হস্তান্তরের সারাংশ')}>
                <KV
                  rows={[
                    [tx('জমির নং'), l?.land_code ?? '—'],
                    [tx('মৌজা'), l?.mouza ?? '—'],
                    [tx('দাগ নং'), l ? digits(l.dag_no) : '—'],
                    [tx('খতিয়ান নং'), l ? digits(l.khatian_no) : '—'],
                    [tx('জমির ধরন'), l?.land_type ? <Tag className="fl-tag ll-green">{l.land_type}</Tag> : '—'],
                    [tx('মোট পরিমাণ'), l ? tx('{{p0}} একর', { p0: acres(l.area_decimal) }) : '—'],
                    [tx('হস্তান্তরিত পরিমাণ'), transferArea ? tx('{{p0}} একর ({{p1}}%)', { p0: acres(transferArea), p1: digits(transferShare ?? 0) }) : '—'],
                    [tx('অবস্থান'), l?.location || '—'],
                  ]}
                />
              </Section>

              <Section icon="users" title={tx('মালিকানা হস্তান্তরের সারাংশ')}>
                <div className="lt-flow">
                  <div className="lt-flow-who">
                    {from ? <Photo url={from.photo_url} name={nameOf(from)} size={48} /> : <span className="lt-initials lt-ph" />}
                    <div>
                      <small>{tx('আগে (বর্তমান মালিক)')}</small>
                      <b>{from ? nameOf(from) : '—'}</b>
                      <span className="lt-muted">{from ? [from.member_no && digits(from.member_no), digits(from.mobile ?? '')].filter(Boolean).join(' | ') : ''}</span>
                    </div>
                  </div>
                  <ArrowDownOutlined className="lt-flow-arrow" />
                  <div className="lt-flow-who">
                    {to.data ? <Photo url={to.data.photo_url} name={nameOf(to.data)} size={48} /> : <span className="lt-initials lt-ph" />}
                    <div>
                      <small className="lt-green">{tx('পরে (নতুন মালিক)')}</small>
                      <b>{to.data ? nameOf(to.data) : '—'}</b>
                      <span className="lt-muted">{to.data ? [to.data.member && digits(to.data.member.member_no), digits(to.data.mobile ?? '')].filter(Boolean).join(' | ') : ''}</span>
                    </div>
                  </div>
                </div>
              </Section>

              <Section icon="file" title={tx('গুরুত্বপূর্ণ তথ্য')}>
                <ul className="lt-notes">
                  <li>{tx('সব ডকুমেন্ট (দলিল, নামজারি) হালনাগাদ ও বৈধ কিনা নিশ্চিত করুন।')}</li>
                  <li>{tx('হস্তান্তর স্থানীয় আইন ও নিবন্ধনের সাথে মিল থাকতে হবে।')}</li>
                  <li>{tx('যাচাইয়ের সময় উভয় পক্ষ উপস্থিত থাকা ভালো।')}</li>
                  <li>{tx('অনুমোদনের পরই হস্তান্তর কার্যকর হবে; জমির মালিকানার ইতিহাস রাখা থাকবে।')}</li>
                </ul>
              </Section>

              <div className="lt-actions">
                <Button onClick={() => navigate('/lands/transfers')} disabled={false}>
                  {tx('বাতিল')}
                </Button>
                <Button icon={<SaveFilled />} loading={saving === 'draft'} disabled={!!locked || !!saving} onClick={() => save(false)}>
                  {tx('খসড়া সংরক্ষণ')}
                </Button>
                <Button type="primary" icon={<SendOutlined />} loading={saving === 'submit'} disabled={!!locked || !!saving || step < 2} title={step < 2 ? tx('শেষ ধাপে পাঠানো যাবে') : undefined} onClick={() => save(true)}>
                  {tx('অনুমোদনের জন্য পাঠান')}
                </Button>
              </div>
            </aside>
          </div>
        </Form>
      </div>
    </ConfigProvider>
  )
}
