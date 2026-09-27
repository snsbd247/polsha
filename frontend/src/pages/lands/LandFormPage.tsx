import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { Alert, App, Button, ConfigProvider, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Spin, Table, Tooltip, Upload } from 'antd'
import {
  AimOutlined,
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EyeFilled,
  FileImageFilled,
  FilePdfFilled,
  HomeOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  RightOutlined,
  SaveFilled,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import ProtectedImage from '../../components/ProtectedImage'
import { LevelSelect } from '../../components/LocationCascader'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { useLandMeta, type LandRow } from '../../lib/land'
import { openProtectedFile } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import './land-form.css'

type Person = { id: number; farmer_code: string; name_bn: string; name_en: string | null; mobile: string | null; nid: string | null; photo_url: string | null; member: { member_no: number } | null }
type Doc = { id: number; type: string; title: string | null; original_name: string; mime: string | null }
type LandDetail = LandRow & {
  mouza_id: number
  land_type_id: number | null
  remarks: string | null
  village_id: number | null
  latitude: number | null
  longitude: number | null
  location_note: string | null
  irrigable_decimal: number | null
  owner_cards: { id: number; name_bn: string; name_en: string | null; share_percent: number }[]
  cultivator_card: { id: number; name_bn: string; name_en: string | null } | null
  documents: Doc[]
}
type MouzaFull = Mouza & {
  union: { id: number; name_bn: string; upazila: { id: number; name_bn: string; district_id: number; district: { id: number; name_bn: string } } }
  villages: { id: number; name_bn: string }[]
  patwaris: { id: number; name: string; mobile: string }[]
}
type Place = { id: number; name_bn: string; district_id?: number }
type Match = { id: number; land_code: string; area_decimal: string; owners: { farmer: { name_bn: string } }[] }
type Pending = { key: string; file: File; type: string }
/** a row of the documents table: a file waiting to be uploaded, or one already saved */
type DocRow = { key: string; name: string; mime: string | null; type: string; pending?: Pending; doc?: Doc }

const SQFT_PER_ACRE = 43560

export default function LandFormPage() {
  const { id } = useParams()
  const { data: existing, isLoading } = useQuery({
    queryKey: ['lands', id],
    queryFn: async () => (await api.get<LandDetail>(`/lands/${id}`)).data,
    enabled: !!id,
  })
  if (id && (isLoading || !existing)) return <Spin />
  return <LandForm key={id ?? 'new'} id={id} existing={existing} />
}

function Section({ icon, color, title, children, className }: { icon: string; color: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`lf-card ${className ?? ''}`}>
      <header className="lf-card-head">
        <DashIcon name={icon} size={20} color={color} stroke={2.2} />
        <h3>{title}</h3>
      </header>
      <div className="lf-card-body">{children}</div>
    </section>
  )
}

/** The chosen owner/cultivator: photo and the few facts that confirm it is the right person. */
function PersonCard({ farmerId, tone }: { farmerId?: number | null; tone: 'blue' | 'green' }) {
  const { data: p } = useQuery({
    queryKey: ['farmers', farmerId, 'card'],
    queryFn: async () => (await api.get<Person>(`/farmers/${farmerId}`)).data,
    enabled: !!farmerId,
  })
  if (!farmerId) return <div className={`lf-person lf-person-${tone} lf-person-empty`}>{tx('এখনো কাউকে বাছাই করা হয়নি')}</div>
  if (!p) return <div className={`lf-person lf-person-${tone}`}><Spin size="small" /></div>
  return (
    <div className={`lf-person lf-person-${tone}`}>
      <ProtectedImage url={p.photo_url} size={56} shape="square" />
      <div>
        <Link to={`/farmers/${p.id}`} className="lf-person-name">
          {nameOf(p)}
        </Link>
        <dl>
          <dt>{tx('সদস্য নং')}:</dt>
          <dd>{p.member ? digits(p.member.member_no) : tx('সদস্য নন')}</dd>
          <dt>{tx('মোবাইল')}:</dt>
          <dd>{digits(p.mobile ?? '') || '—'}</dd>
          <dt>NID:</dt>
          <dd>{digits(p.nid ?? '') || '—'}</dd>
        </dl>
      </div>
    </div>
  )
}

/** Farmer search box with the blue search button of the design (it opens the dropdown). */
function PickRow({ value, onChange, exclude }: { value?: number | null; onChange?: (v: number | null) => void; exclude?: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="lf-pick" ref={ref}>
      <FarmerPicker value={value} onChange={(v) => onChange?.(v)} placeholder={tx('কৃষক বাছাই করুন')} exclude={exclude} />
      <Button
        type="primary"
        icon={<SearchOutlined />}
        aria-label={tx('খুঁজুন')}
        onClick={() => {
          const input = ref.current?.querySelector('input')
          input?.focus()
          input?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        }}
      />
    </div>
  )
}

function LandForm({ id, existing }: { id?: string; existing?: LandDetail }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useLandMeta()
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const [docs, setDocs] = useState<Doc[]>(existing?.documents ?? [])
  const [district, setDistrict] = useState<number | undefined>()
  const [upazila, setUpazila] = useState<number | undefined>()
  const [union, setUnion] = useState<number | undefined>()

  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })
  const places = useQuery({ queryKey: ['mouzas', 'summary'], queryFn: async () => (await api.get<{ districts: Place[]; upazilas: Place[] }>('/mouzas-summary')).data })
  const summary = useQuery({ queryKey: ['lands', 'summary'], queryFn: async () => (await api.get<{ next_code: string | null }>('/lands/summary')).data, enabled: !isEdit })

  const mouzaId: number | undefined = Form.useWatch('mouza_id', form)
  const mouza = useQuery({
    queryKey: ['mouzas', mouzaId, 'full'],
    queryFn: async () => (await api.get<MouzaFull>(`/mouzas/${mouzaId}`)).data,
    enabled: !!mouzaId,
  })
  // picking a mouza fills in where it lies
  useEffect(() => {
    const u = mouza.data?.union
    if (!u) return
    setUnion(u.id)
    setUpazila(u.upazila?.id)
    setDistrict(u.upazila?.district_id)
  }, [mouza.data])

  const initialValues = useMemo(
    () =>
      existing
        ? {
            ...existing,
            area: Number((existing.area_decimal / 100).toFixed(4)),
            irrigable_area: existing.irrigable_decimal != null ? Number((existing.irrigable_decimal / 100).toFixed(4)) : undefined,
            ownership: existing.owners.length > 1 ? 'joint' : 'single',
          }
        : {
            survey: 'RS',
            status: 'cultivated',
            ownership: 'single',
            owned_since: dayjs(),
            joint: [{ share_percent: 50 }, { share_percent: 50 }],
            is_borga: false,
            borga_type: 'borga',
          },
    [existing],
  )

  const area: number | undefined = Form.useWatch('area', form)
  const irrigable: number | undefined = Form.useWatch('irrigable_area', form)
  const ownership: string | undefined = Form.useWatch('ownership', form)
  const ownerId: number | undefined = Form.useWatch('owner_id', form)
  const joint: { farmer_id?: number; share_percent?: number }[] | undefined = Form.useWatch('joint', form)
  const cultivatorId: number | undefined = Form.useWatch('cultivator_id', form)
  const isBorga: boolean | undefined = Form.useWatch('is_borga', form)

  const mouzaOptions = (mouzas.data ?? [])
    .filter((m) => (!union || m.union_id === union) && (!upazila || m.upazila_id === upazila) && (!district || (places.data?.upazilas ?? []).some((u) => u.id === m.upazila_id && u.district_id === district)))
    .map((m) => ({ value: m.id, label: nameOf(m) }))
  const upazilaOptions = (places.data?.upazilas ?? []).filter((u) => !district || u.district_id === district)

  const locate = () => {
    if (!navigator.geolocation) {
      message.error(tx('এই ব্রাউজারে অবস্থান নেওয়া যায় না।'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => form.setFieldsValue({ latitude: Number(pos.coords.latitude.toFixed(7)), longitude: Number(pos.coords.longitude.toFixed(7)) }),
      () => message.error(tx('অবস্থান পাওয়া যায়নি — ব্রাউজারে অবস্থানের অনুমতি দিন।')),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const uploadDoc = async (landId: number | string, d: Pending) => {
    const fd = new FormData()
    fd.append('type', d.type)
    fd.append('file', d.file)
    return (await api.post<Doc>(`/lands/${landId}/documents`, fd)).data
  }
  const addFiles = (files: File[]) => {
    const ok = files.filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.name) && f.size <= 5 * 1024 * 1024)
    if (ok.length < files.length) message.warning(tx('শুধু PDF, JPG বা PNG, প্রতিটি সর্বোচ্চ ৫ MB।'))
    const items = ok.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, type: 'khatian' }))
    if (isEdit) {
      // the land exists already: upload straight away
      items.forEach((it) =>
        uploadDoc(id!, it)
          .then((d) => setDocs((x) => [d, ...x]))
          .catch((e) => message.error(errorMessage(e))),
      )
    } else setPending((p) => [...p, ...items])
  }

  const save = async (confirm = false) => {
    const v = await form.validateFields()
    const owners =
      v.ownership === 'joint'
        ? (v.joint ?? []).filter((o: { farmer_id?: number }) => o.farmer_id).map((o: { farmer_id: number; share_percent: number }) => ({ farmer_id: o.farmer_id, share_percent: o.share_percent }))
        : [{ farmer_id: v.owner_id, share_percent: 100 }]
    const fmt = (d?: Dayjs) => d?.format('YYYY-MM-DD')
    const payload: Record<string, unknown> = {
      mouza_id: v.mouza_id,
      survey: v.survey,
      khatian_no: v.khatian_no,
      dag_no: v.dag_no,
      area: v.area,
      area_unit: 'acre',
      irrigable_area: v.irrigable_area ?? null,
      land_type_id: v.land_type_id,
      irrigation_type_id: v.irrigation_type_id ?? null,
      status: v.status,
      remarks: v.remarks ?? null,
      village_id: v.village_id ?? null,
      latitude: v.latitude ?? null,
      longitude: v.longitude ?? null,
      location_note: v.location_note ?? null,
      confirm_duplicate: confirm,
    }
    if (!isEdit) {
      payload.owners = owners
      payload.owned_since = fmt(v.owned_since)
      if (v.cultivator_id) {
        // no borga: the cultivator farms their own land; with borga the terms carry the share and the agreed end.
        // Terms are stored data, so they are always written in Bangla whatever the screen language.
        const terms = v.is_borga
          ? [v.borga_share != null ? `ফসলের ${v.borga_share}%` : null, v.contract_end ? `চুক্তি শেষ: ${v.contract_end.format('DD/MM/YYYY')}` : null].filter(Boolean).join(' · ')
          : null
        payload.cultivation = {
          farmer_id: v.cultivator_id,
          type: v.is_borga ? v.borga_type : 'own',
          terms: terms || null,
          start_date: fmt(v.is_borga && v.contract_start ? v.contract_start : v.owned_since),
        }
      }
    }
    setSaving(true)
    try {
      const r = isEdit ? await api.put(`/lands/${id}`, payload) : await api.post<{ id: number }>('/lands', payload)
      const landId = r.data.id
      // papers chosen before the land existed go up now
      const failed: string[] = []
      for (const d of pending) {
        try {
          await uploadDoc(landId, d)
        } catch {
          failed.push(d.file.name)
        }
      }
      if (failed.length) message.warning(tx('জমি সংরক্ষণ হয়েছে, কিন্তু এই ফাইলগুলো ওঠেনি: {{p0}}', { p0: failed.join(', ') }))
      else message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['lands'] })
      setMatches(null)
      navigate(`/lands/${landId}`)
    } catch (e) {
      const err = e as AxiosError<{ code?: string; matches?: Match[] }>
      if (err.response?.status === 409 && err.response.data?.code === 'possible_duplicate') setMatches(err.response.data.matches ?? [])
      else if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    form.resetFields()
    setPending([])
    setDistrict(undefined)
    setUpazila(undefined)
    setUnion(undefined)
  }

  const docRows: DocRow[] = [
    ...pending.map((p) => ({ key: p.key, name: p.file.name, mime: p.file.type, type: p.type, pending: p })),
    ...docs.map((d) => ({ key: `d${d.id}`, name: d.title || meta?.document_types[d.type] || d.original_name, mime: d.mime, type: d.type, doc: d })),
  ]
  const jointTotal = (joint ?? []).reduce((s, o) => s + Number(o?.share_percent ?? 0), 0)
  const selectedOwnerIds = ownership === 'joint' ? (joint ?? []).map((o) => o?.farmer_id).filter(Boolean) : [ownerId].filter(Boolean)

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="lf">
        <nav className="lf-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="lf-crumb-sep" />
          <Link to="/lands">{tx('জমি ব্যবস্থাপনা')}</Link>
          <RightOutlined className="lf-crumb-sep" />
          <span>{isEdit ? tx('জমি সম্পাদনা') : tx('জমি যোগ করুন')}</span>
        </nav>

        <div className="lf-head">
          <div>
            <h1>{isEdit ? tx('জমি সম্পাদনা — {{p0}}', { p0: existing?.land_code }) : tx('জমি যোগ করুন')}</h1>
            <p>{isEdit ? tx('জমির তথ্য হালনাগাদ করে সংরক্ষণ করুন।') : tx('সমিতির অধীনে নতুন জমির রেকর্ড যোগ করুন। নিচের তথ্য পূরণ করে সংরক্ষণ করুন।')}</p>
          </div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/lands')}>
            {tx('জমির তালিকায় ফিরুন')}
          </Button>
        </div>

        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onFinish={() => save(false)}
          requiredMark={(label, { required: req }) => (
            <>
              {label}
              {req && <span className="lf-req">*</span>}
            </>
          )}
          className="lf-form"
          // a long form: Enter in a field (a date, a search box) must not save it half-filled — only the Save button does
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault()
          }}
        >
          <div className="lf-row lf-row-1">
            <Section icon="file" color="#1769e0" title={tx('জমির মৌলিক তথ্য')}>
              <div className="lf-grid lf-grid-3">
                <Form.Item label={tx('জমির নং')} required>
                  <Input value={isEdit ? existing?.land_code : (summary.data?.next_code ?? '')} disabled placeholder={tx('স্বয়ংক্রিয়')} />
                </Form.Item>
                <Form.Item name="mouza_id" label={tx('মৌজা')} rules={[required(tx('মৌজা বাছাই করুন'))]}>
                  <Select showSearch={{ optionFilterProp: 'label' }} placeholder={tx('বাছাই করুন')} options={mouzaOptions} onChange={() => form.setFieldValue('village_id', undefined)} />
                </Form.Item>
                <Form.Item name="dag_no" label={tx('দাগ নং')} rules={[required(tx('দাগ দিন'))]}>
                  <Input />
                </Form.Item>
                <Form.Item label={tx('খতিয়ান নং')} required>
                  <div className="lf-khatian">
                    <Form.Item name="survey" noStyle>
                      <Select options={Object.entries(meta?.surveys ?? {}).map(([value, label]) => ({ value, label }))} />
                    </Form.Item>
                    <Form.Item name="khatian_no" noStyle rules={[required(tx('খতিয়ান দিন'))]}>
                      <Input />
                    </Form.Item>
                  </div>
                </Form.Item>
                <Form.Item name="land_type_id" label={tx('জমির ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
                  <Select placeholder={tx('বাছাই করুন')} options={meta?.land_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                </Form.Item>
                <Form.Item name="ownership" label={tx('মালিকানার ধরন')} rules={[{ required: true }]}>
                  <Select
                    disabled={isEdit}
                    options={[
                      { value: 'single', label: tx('একক') },
                      { value: 'joint', label: tx('যৌথ') },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="status" label={tx('অবস্থা')} rules={[{ required: true }]}>
                  <Select options={Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
                <Form.Item name="remarks" label={tx('মন্তব্য')} className="lf-span-2">
                  <Input.TextArea rows={1} autoSize={{ minRows: 1, maxRows: 3 }} />
                </Form.Item>
              </div>
            </Section>

            <Section icon="mapPin" color="#1769e0" title={tx('অবস্থানের তথ্য')}>
              <div className="lf-grid lf-grid-3">
                <Form.Item label={tx('জেলা')} required>
                  <Select
                    value={district}
                    placeholder={tx('বাছাই করুন')}
                    options={(places.data?.districts ?? []).map((d) => ({ value: d.id, label: d.name_bn }))}
                    onChange={(v) => {
                      setDistrict(v)
                      setUpazila(undefined)
                      setUnion(undefined)
                    }}
                  />
                </Form.Item>
                <Form.Item label={tx('উপজেলা')} required>
                  <Select
                    value={upazila}
                    placeholder={tx('বাছাই করুন')}
                    options={upazilaOptions.map((u) => ({ value: u.id, label: u.name_bn }))}
                    onChange={(v) => {
                      setUpazila(v)
                      setUnion(undefined)
                    }}
                  />
                </Form.Item>
                <Form.Item label={tx('ইউনিয়ন')} required>
                  <LevelSelect index={3} parentId={upazila} value={union} onChange={setUnion} placeholder={tx('বাছাই করুন')} />
                </Form.Item>
                <Form.Item name="village_id" label={tx('গ্রাম')}>
                  <Select
                    allowClear
                    disabled={!mouzaId}
                    placeholder={mouzaId ? tx('বাছাই করুন') : tx('আগে মৌজা বাছাই করুন')}
                    options={(mouza.data?.villages ?? []).map((vl) => ({ value: vl.id, label: vl.name_bn }))}
                  />
                </Form.Item>
                <Form.Item label={tx('পাটোয়ারী')}>
                  <Select
                    disabled
                    value={mouza.data?.patwaris.length ? mouza.data.patwaris.map((p) => p.id) : undefined}
                    mode="multiple"
                    maxTagCount="responsive"
                    placeholder={mouzaId ? tx('এই মৌজায় পাটোয়ারী নেই') : tx('মৌজা থেকে আসবে')}
                    options={(mouza.data?.patwaris ?? []).map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Form.Item>
                <div className="lf-coords">
                  <Form.Item name="latitude" label={tx('অক্ষাংশ (Latitude)')}>
                    <InputNumber min={-90} max={90} step={0.0001} style={{ width: '100%' }} placeholder="24.0023" />
                  </Form.Item>
                  <Tooltip title={tx('এখানকার অবস্থান নিন (মাঠে দাঁড়িয়ে)')}>
                    <Button type="text" className="lf-locate" icon={<AimOutlined />} aria-label={tx('অবস্থান নিন')} onClick={locate} />
                  </Tooltip>
                  <Form.Item name="longitude" label={tx('দ্রাঘিমাংশ (Longitude)')}>
                    <InputNumber min={-180} max={180} step={0.0001} style={{ width: '100%' }} placeholder="90.4267" />
                  </Form.Item>
                  <Tooltip title={tx('এখানকার অবস্থান নিন (মাঠে দাঁড়িয়ে)')}>
                    <Button type="text" className="lf-locate" icon={<AimOutlined />} aria-label={tx('অবস্থান নিন')} onClick={locate} />
                  </Tooltip>
                </div>
                <Form.Item name="location_note" label={tx('ঠিকানা / অবস্থানের বিবরণ')} className="lf-span-2">
                  <Input.TextArea rows={2} maxLength={300} placeholder={tx('যেমন: শিবপুর বাজারের পূর্ব পাশে, রাস্তার ধারে')} />
                </Form.Item>
              </div>
            </Section>
          </div>

          <div className="lf-row lf-row-2">
            <Section icon="bars" color="#1769e0" title={tx('পরিমাণের বিবরণ')}>
              <div className="lf-grid lf-grid-2">
                <Form.Item name="area" label={tx('মোট পরিমাণ (একর)')} rules={[required(tx('পরিমাণ দিন'))]}>
                  <InputNumber min={0.0001} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label={tx('মোট পরিমাণ (বর্গফুট)')}>
                  <Input disabled value={area ? digits(Math.round(area * SQFT_PER_ACRE).toLocaleString('en-IN')) : ''} />
                </Form.Item>
                <Form.Item
                  name="irrigable_area"
                  label={tx('সেচকৃত জমি (একর)')}
                  rules={[{ validator: (_, v) => (v == null || !area || v <= area ? Promise.resolve() : Promise.reject(new Error(tx('মোট পরিমাণের বেশি হতে পারে না')))) }]}
                >
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label={tx('সেচহীন জমি (একর)')}>
                  <Input disabled value={area && irrigable != null ? digits(Math.max(0, area - irrigable).toFixed(2)) : ''} />
                </Form.Item>
                <Form.Item name="irrigation_type_id" label={tx('সেচের ধরন')} className="lf-span-2" extra={tx('সেচের রেট এই ধরন অনুযায়ী ঠিক হয়')}>
                  <Select allowClear placeholder={tx('বাছাই করুন')} options={meta?.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                </Form.Item>
              </div>
            </Section>

            <Section icon="users" color="#1f9d55" title={tx('মালিকানার তথ্য')}>
              {isEdit ? (
                <div className="lf-readonly">
                  {existing?.owner_cards.map((o) => (
                    <div key={o.id}>
                      <Link to={`/farmers/${o.id}`}>{nameOf(o)}</Link> <span className="lf-muted">({digits(o.share_percent)}%)</span>
                    </div>
                  ))}
                  <Alert type="info" showIcon title={tx('মালিকানা বদলাতে জমির প্রোফাইলের "মালিকানা হস্তান্তর" ব্যবহার করুন — এতে ইতিহাস থাকে।')} />
                </div>
              ) : ownership === 'joint' ? (
                <>
                  <Form.List name="joint">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((f) => (
                          <div key={f.key} className="lf-joint">
                            <Form.Item name={[f.name, 'farmer_id']} rules={[required(tx('মালিক বাছাই করুন'))]} className="lf-joint-who">
                              <FarmerPicker placeholder={tx('কৃষক বাছাই করুন')} />
                            </Form.Item>
                            <Form.Item name={[f.name, 'share_percent']} rules={[required(tx('অংশ দিন'))]} className="lf-joint-share">
                              <InputNumber min={0.01} max={100} addonAfter="%" />
                            </Form.Item>
                            {fields.length > 2 && <MinusCircleOutlined className="lf-joint-del" onClick={() => remove(f.name)} />}
                          </div>
                        ))}
                        <div className="lf-joint-foot">
                          <Button size="small" icon={<PlusOutlined />} onClick={() => add({ share_percent: 0 })}>
                            {tx('মালিক যোগ করুন')}
                          </Button>
                          <span className={jointTotal === 100 ? 'lf-ok' : 'lf-bad'}>{tx('মোট {{p0}}%', { p0: digits(jointTotal) })}</span>
                        </div>
                      </>
                    )}
                  </Form.List>
                </>
              ) : (
                <>
                  <Form.Item name="owner_id" label={tx('মালিক')} rules={[required(tx('মালিক বাছাই করুন'))]}>
                    <PickRow />
                  </Form.Item>
                  <PersonCard farmerId={ownerId} tone="blue" />
                </>
              )}
              {!isEdit && (
                <Form.Item name="owned_since" label={tx('মালিকানার শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]} className="lf-since">
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
              )}
            </Section>

            <Section icon="userCheck" color="#f08c00" title={tx('বর্তমান চাষির তথ্য')}>
              {isEdit ? (
                <div className="lf-readonly">
                  {existing?.cultivator_card ? <Link to={`/farmers/${existing.cultivator_card.id}`}>{nameOf(existing.cultivator_card)}</Link> : <span className="lf-muted">{tx('এখন কোনো চাষি নেই')}</span>}
                  <Alert type="info" showIcon title={tx('চাষি বদলাতে জমির প্রোফাইলের "চাষি পরিবর্তন" ব্যবহার করুন।')} />
                </div>
              ) : (
                <>
                  <Form.Item
                    name="cultivator_id"
                    label={tx('চাষি')}
                    extra={tx('খালি রাখলে পরে জমির প্রোফাইল থেকে দেওয়া যাবে। বর্গা না হলে চাষিকে মালিকদের একজন হতে হবে।')}
                  >
                    <PickRow />
                  </Form.Item>
                  <PersonCard farmerId={cultivatorId} tone="green" />
                  {cultivatorId && !isBorga && !selectedOwnerIds.includes(cultivatorId) && (
                    <Alert className="lf-warn" type="warning" showIcon title={tx('এই চাষি মালিক নন — নিচে "বর্গা / লিজ" হ্যাঁ করুন।')} />
                  )}
                </>
              )}
            </Section>
          </div>

          <div className="lf-row lf-row-3">
            <Section icon="share" color="#6d4ae6" title={tx('বর্গা / লিজ (প্রযোজ্য হলে)')}>
              {isEdit ? (
                <div className="lf-readonly">
                  <span className="lf-muted">{existing?.cultivation ? [meta?.cultivation_types[existing.cultivation.type], existing.cultivation.terms].filter(Boolean).join(' · ') || '—' : '—'}</span>
                </div>
              ) : (
                <div className="lf-grid lf-grid-3">
                  <Form.Item name="is_borga" label={tx('বর্গা / লিজ?')}>
                    <Radio.Group
                      options={[
                        { value: true, label: tx('হ্যাঁ') },
                        { value: false, label: tx('না') },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="borga_type" label={tx('ধরন')}>
                      <Select disabled={!isBorga} options={[{ value: 'borga', label: meta?.cultivation_types.borga ?? tx('বর্গা') }, { value: 'lease', label: meta?.cultivation_types.lease ?? tx('লিজ') }]} />
                    </Form.Item>
                  <Form.Item name="borga_share" label={tx('ফসলের অংশ (%)')}>
                    <InputNumber disabled={!isBorga} min={0} max={100} style={{ width: '100%' }} placeholder="0" />
                  </Form.Item>
                  <Form.Item name="contract_start" label={tx('চুক্তি শুরুর তারিখ')} rules={[{ required: !!isBorga && !!cultivatorId, message: tx('তারিখ দিন') }]}>
                    <DatePicker disabled={!isBorga} format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                  </Form.Item>
                  <Form.Item name="contract_end" label={tx('চুক্তি শেষের তারিখ')}>
                    <DatePicker disabled={!isBorga} format="DD/MM/YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              )}
            </Section>

            <Section icon="file" color="#e0383e" title={tx('জমির ডকুমেন্ট')}>
              <div className="lf-docs">
                <Upload.Dragger
                  multiple
                  showUploadList={false}
                  accept=".pdf,.jpg,.jpeg,.png"
                  beforeUpload={(file, list) => {
                    if (file === list[0]) addFiles(list as unknown as File[])
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
                      render: (_, r) =>
                        r.pending ? (
                          <Select
                            size="small"
                            className="lf-doc-type"
                            value={r.type}
                            options={Object.entries(meta?.document_types ?? {}).map(([value, label]) => ({ value, label }))}
                            onChange={(t) => setPending((p) => p.map((x) => (x.key === r.key ? { ...x, type: t } : x)))}
                          />
                        ) : (
                          r.name
                        ),
                    },
                    { title: tx('ফাইল'), width: 44, align: 'center', render: (_, r) => (r.mime?.includes('pdf') ? <FilePdfFilled className="lf-pdf" /> : <FileImageFilled className="lf-img" />) },
                    {
                      title: tx('অ্যাকশন'),
                      width: 70,
                      align: 'center',
                      render: (_, r) => (
                        <span className="lf-doc-actions">
                          <Button
                            type="text"
                            size="small"
                            icon={<EyeFilled />}
                            aria-label={tx('দেখুন')}
                            onClick={() => (r.pending ? window.open(URL.createObjectURL(r.pending.file), '_blank', 'noopener') : openProtectedFile(`/lands/${id}/documents/${r.doc!.id}`).catch((e) => message.error(errorMessage(e))))}
                          />
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={tx('মুছুন')}
                            onClick={() =>
                              r.pending
                                ? setPending((p) => p.filter((x) => x.key !== r.key))
                                : api
                                    .delete(`/lands/${id}/documents/${r.doc!.id}`)
                                    .then(() => setDocs((d) => d.filter((x) => x.id !== r.doc!.id)))
                                    .catch((e) => message.error(errorMessage(e)))
                            }
                          />
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </Section>
          </div>

          <div className="lf-actions">
            <Button onClick={reset}>{tx('রিসেট')}</Button>
            <Button type="primary" htmlType="submit" icon={<SaveFilled />} loading={saving}>
              {tx('জমি সংরক্ষণ করুন')}
            </Button>
          </div>
        </Form>

        <Modal
          open={!!matches}
          width={640}
          title={tx('একই দাগে আগে থেকেই জমি আছে')}
          onCancel={() => setMatches(null)}
          footer={[
            <Button key="back" onClick={() => setMatches(null)}>
              {tx('ফিরে যান')}
            </Button>,
            <Button key="save" type="primary" danger loading={saving} onClick={() => save(true)}>
              {tx('আলাদা অংশ — সংরক্ষণ করুন')}
            </Button>,
          ]}
        >
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('একই মৌজা, জরিপ, খতিয়ান ও দাগে জমি আছে। একই দাগের আলাদা অংশ হলে সংরক্ষণ করুন; নইলে আগের জমিটি খুলুন।')} />
          <Table<Match>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={matches ?? []}
            columns={[
              { title: 'Land ID', dataIndex: 'land_code', render: (v, m) => <a href={`/lands/${m.id}`} target="_blank" rel="noreferrer">{v}</a> },
              { title: tx('পরিমাণ'), dataIndex: 'area_decimal', render: (v) => tx('{{p0}} শতক', { p0: digits(Number(v)) }) },
              { title: tx('মালিক'), render: (_, m) => m.owners.map((o) => o.farmer.name_bn).join(', ') },
            ]}
          />
        </Modal>
      </div>
    </ConfigProvider>
  )
}
