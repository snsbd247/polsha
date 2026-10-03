import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { Alert, App, Button, Checkbox, ConfigProvider, DatePicker, Form, Input, Modal, Radio, Select, Spin, Tooltip, Upload } from 'antd'
import {
  ArrowLeftOutlined,
  CameraFilled,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EnvironmentFilled,
  FileTextOutlined,
  FileTextFilled,
  HomeOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveFilled,
  UpOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import DuplicateMatches from '../../components/DuplicateMatches'
import { LevelSelect, LEVELS, useLevelNames, type LocationPath } from '../../components/LocationCascader'
import ProtectedImage from '../../components/ProtectedImage'
import { TeamSolid, UserSolid } from '../../components/SideIcons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, toEnDigits } from '../../lib/format'
import { toOptions, useFarmerMeta, type DuplicateMatch } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { usePublicSettings } from '../../lib/settings'
import { nameOf, t as tx } from '../../lib/i18n'
import './farmer-form.css'

type FamilyRow = { key: number; name?: string; relation?: string; occupation?: string; mobile?: string }

type FarmerDetail = Record<string, unknown> & {
  id: number
  farmer_code: string
  photo_url: string | null
  location_path: number[]
  household: { id: number; code: string; head: { name_bn: string } | null } | null
  family?: { id: number; name: string; relation: string | null; occupation: string | null; mobile: string | null }[]
}

type Household = { id: number; code: string; head: { name_bn: string } | null; village: { name_bn: string } | null }
type DocSlot = 'nid_front' | 'nid_back' | 'other'

const digitRule = (re: RegExp, message: string) => ({
  validator: (_: unknown, v?: string) => (!v || re.test(toEnDigits(v)) ? Promise.resolve() : Promise.reject(new Error(message))),
})
const MOBILE = /^01[3-9]\d{8}$/
let rowKey = 1
const blankRows = (n: number): FamilyRow[] => Array.from({ length: n }, () => ({ key: rowKey++ }))

export default function FarmerFormPage() {
  const { id } = useParams()
  const { data: existing, isLoading } = useQuery({
    queryKey: ['farmers', id],
    queryFn: async () => (await api.get<FarmerDetail>(`/farmers/${id}`)).data,
    enabled: !!id,
  })

  // a new farmer starts in the society's default village and mouza (General Settings)
  const { data: settings, isLoading: settingsLoading } = usePublicSettings()
  // option labels must be there first, or selects would show raw values like 'male'
  const { data: meta } = useFarmerMeta()
  if (!meta) return <Spin />
  if (id && (isLoading || !existing)) return <Spin />
  if (!id && settingsLoading) return <Spin />
  const defaults = { path: settings?.default_location ?? [], mouza_id: settings?.default_mouza_id ?? undefined }
  return <FarmerForm key={id ?? 'new'} id={id} existing={existing} defaults={defaults} />
}

/** Card with the light-blue title band. */
function Section({ icon, title, extra, className, children }: { icon: ReactNode; title: ReactNode; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`ff-card ${className ?? ''}`}>
      <header className="ff-card-head">
        <h3>
          <span className="ff-card-icon">{icon}</span>
          {title}
        </h3>
        {extra}
      </header>
      <div className="ff-card-body">{children}</div>
    </section>
  )
}

function FarmerForm({ id, existing, defaults }: { id?: string; existing?: FarmerDetail; defaults: { path: LocationPath; mouza_id?: number } }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useFarmerMeta()
  const startPath = existing?.location_path ?? defaults.path
  const [path, setPath] = useState<LocationPath>(startPath)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string>()
  const [docs, setDocs] = useState<Partial<Record<DocSlot, File>>>({})
  const [family, setFamily] = useState<FamilyRow[]>(() =>
    existing?.family?.length ? existing.family.map((f) => ({ key: rowKey++, name: f.name, relation: f.relation ?? undefined, occupation: f.occupation ?? undefined, mobile: f.mobile ?? undefined })) : blankRows(3),
  )
  const [memberMode, setMemberMode] = useState<'non_member' | 'existing'>('non_member')
  const [applyAfter, setApplyAfter] = useState(false)
  const [householdMode, setHouseholdMode] = useState<'none' | 'existing' | 'new'>(() => (existing?.household ? 'existing' : 'none'))
  const [householdTerm, setHouseholdTerm] = useState('')
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [more, setMore] = useState(() => !!existing && !!(existing.mother_name || existing.date_of_birth || existing.alt_mobile || existing.email || existing.occupation || existing.post_office || existing.spouse_name || existing.remarks))
  // the division-to-union levels come from the society's default area; shown only when changing it
  const [showArea, setShowArea] = useState(() => startPath.filter(Boolean).length < 4)
  const areaLine = useLevelNames(path, 4).join(', ')

  const initialValues = useMemo(
    () =>
      existing ? { ...existing, date_of_birth: existing.date_of_birth ? dayjs(String(existing.date_of_birth)) : null } : { gender: 'male', is_active: true, occupation: 'farmer', mouza_id: defaults.path[4] ? defaults.mouza_id : undefined },
    [existing, defaults],
  )

  // object URL for the chosen photo
  useEffect(() => {
    if (!photo) return setPhotoPreview(undefined)
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const villageId = path[4]
  const mouzas = useQuery({
    queryKey: ['mouzas', 'by-village', villageId],
    queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1, village_id: villageId } })).data,
    enabled: !!villageId,
  })

  const households = useQuery({
    queryKey: ['households', 'lookup', householdTerm],
    queryFn: async () => (await api.get<Household[]>('/households/lookup', { params: { q: householdTerm } })).data,
    enabled: householdMode === 'existing',
  })

  const dob: Dayjs | null = Form.useWatch('date_of_birth', form)
  const isMinor = dob ? dayjs().diff(dob, 'year') < 18 : false
  const canLegacy = !isEdit && can('member.admin')
  const canApply = !isEdit && memberMode === 'non_member' && can('membership.create')

  const setLevel = (i: number, v?: number) => {
    setPath([...path.slice(0, i), v, ...Array(4 - i).fill(undefined)].slice(0, 5))
    form.setFieldValue('mouza_id', undefined)
  }
  const setRow = (key: number, patch: Partial<FamilyRow>) => setFamily((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const buildBody = (values: Record<string, unknown>, confirm: boolean) => {
    const fd = new FormData()
    const payload: Record<string, unknown> = {
      ...values,
      legacy_admitted_on: values.legacy_admitted_on ? (values.legacy_admitted_on as Dayjs).format('YYYY-MM-DD') : '',
      village_id: villageId,
      date_of_birth: values.date_of_birth ? (values.date_of_birth as Dayjs).format('YYYY-MM-DD') : '',
      household_id: householdMode === 'existing' ? values.household_id : '',
      household_relation: householdMode === 'existing' ? values.household_relation : '',
      new_household: householdMode === 'new' ? 1 : 0,
      confirm_duplicate: confirm ? 1 : 0,
      // blank rows on the form are just empty slots
      family: JSON.stringify(family.filter((r) => r.name?.trim()).map(({ name, relation, occupation, mobile }) => ({ name: name!.trim(), relation, occupation, mobile: mobile ? toEnDigits(mobile) : null }))),
    }
    if (memberMode !== 'existing') {
      delete payload.legacy_member_no
      delete payload.legacy_admitted_on
    }
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    })
    if (photo) fd.append('photo', photo)
    Object.entries(docs).forEach(([slot, file]) => file && fd.append(`doc_${slot}`, file))
    return fd
  }

  const save = async (confirm = false) => {
    const values = await form.validateFields()
    if (!villageId) {
      message.error(tx('গ্রাম বাছাই করুন।'))
      return
    }
    const badRow = family.find((r) => !r.name?.trim() && (r.relation || r.occupation || r.mobile))
    if (badRow) {
      message.error(tx('পরিবারের সদস্যের নাম দিন।'))
      return
    }
    if (family.some((r) => r.mobile && !MOBILE.test(toEnDigits(r.mobile)))) {
      message.error(tx('সঠিক মোবাইল নম্বর দিন'))
      return
    }
    setSaving(true)
    try {
      const body = buildBody(values, confirm)
      const r = isEdit ? await api.post(`/farmers/${id}`, body) : await api.post('/farmers', body)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
      setDuplicates(null)
      navigate(canApply && applyAfter ? `/membership/applications/new?farmer=${r.data.id}` : `/farmers/${r.data.id}`)
    } catch (e) {
      const err = e as AxiosError<{ code?: string; matches?: DuplicateMatch[] }>
      if (err.response?.status === 409 && err.response.data?.code === 'possible_duplicate') {
        setDuplicates(err.response.data.matches ?? [])
      } else if (!applyFormErrors(form, e)) {
        message.error(errorMessage(e))
      }
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    form.resetFields()
    setPath(startPath)
    setPhoto(null)
    setDocs({})
    setFamily(existing?.family?.length ? existing.family.map((f) => ({ key: rowKey++, name: f.name, relation: f.relation ?? undefined, occupation: f.occupation ?? undefined, mobile: f.mobile ?? undefined })) : blankRows(3))
    setMemberMode('non_member')
    setApplyAfter(false)
  }

  const pickFile = (slot: DocSlot) => (f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      message.error(tx('ফাইল ৫MB-এর বেশি।'))
      return Upload.LIST_IGNORE
    }
    setDocs((d) => ({ ...d, [slot]: f }))
    return false
  }

  const docSlots: { slot: DocSlot; label: string }[] = [
    { slot: 'nid_front', label: tx('NID কার্ড (সামনে)') },
    { slot: 'nid_back', label: tx('NID কার্ড (পেছনে)') },
    { slot: 'other', label: tx('অন্যান্য ডকুমেন্ট') },
  ]

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="ff">
        <nav className="ff-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="ff-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="ff-crumb-sep" />
          <span>{isEdit ? tx('কৃষক সম্পাদনা') : tx('কৃষক যোগ করুন')}</span>
        </nav>

        <div className="ff-head">
          <div>
            <h1>{isEdit ? tx('কৃষক সম্পাদনা — {{p0}}', { p0: existing?.farmer_code }) : tx('নতুন কৃষক যোগ করুন')}</h1>
            <p>{isEdit ? tx('কৃষকের তথ্য হালনাগাদ করুন।') : tx('কৃষকের তথ্য দিন। চাইলে একই সাথে সদস্যপদও করা যাবে (ঐচ্ছিক)।')}</p>
          </div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(isEdit ? `/farmers/${id}` : '/farmers')}>
            {isEdit ? tx('প্রোফাইলে ফিরুন') : tx('কৃষক তালিকায় ফিরুন')}
          </Button>
        </div>

        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onFinish={() => save(false)}
          requiredMark={(label, { required: r }) =>
            r ? (
              <>
                {label} <span className="ff-req">*</span>
              </>
            ) : (
              label
            )
          }
        >
          {!isEdit && (
            <section className="ff-member">
              <div className="ff-member-main">
                <h3>
                  <TeamSolid className="ff-member-icon" />
                  {tx('সদস্যপদের বিকল্প')}
                </h3>
                <div className="ff-member-options">
                  <label className={`ff-option ${memberMode === 'non_member' ? 'on' : ''}`}>
                    <Radio checked={memberMode === 'non_member'} onChange={() => setMemberMode('non_member')} />
                    <span>
                      <strong>{tx('সাধারণ কৃষক (নন-মেম্বার)')}</strong>
                      <small>{tx('এই কৃষক এখনো সমিতির সদস্য নন।')}</small>
                    </span>
                  </label>
                  <Tooltip title={canLegacy ? undefined : tx('পুরোনো সদস্য নম্বর দেওয়ার অনুমতি নেই।')}>
                    <label className={`ff-option ${memberMode === 'existing' ? 'on' : ''} ${canLegacy ? '' : 'disabled'}`}>
                      <Radio checked={memberMode === 'existing'} disabled={!canLegacy} onChange={() => setMemberMode('existing')} />
                      <span>
                        <strong>{tx('বিদ্যমান সদস্য')}</strong>
                        <small>{tx('এই কৃষকের আগে থেকেই সদস্য নম্বর আছে।')}</small>
                      </span>
                    </label>
                  </Tooltip>
                </div>
                {memberMode === 'existing' && (
                  <div className="ff-legacy">
                    <Form.Item name="legacy_member_no" label={tx('সদস্য নং')} rules={[required(tx('সদস্য নম্বর দিন')), digitRule(/^\d+$/, tx('শুধু সংখ্যা দিন'))]}>
                      <Input inputMode="numeric" placeholder={tx('পুরোনো খাতার সদস্য নম্বর')} />
                    </Form.Item>
                    <Form.Item name="legacy_admitted_on" label={tx('সদস্যপদের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                      <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                    </Form.Item>
                  </div>
                )}
              </div>
              <div className="ff-member-note">
                <InfoCircleOutlined />
                <span>
                  <strong>{tx('সব সদস্যই কৃষক, কিন্তু সব কৃষক সদস্য নন।')}</strong>
                  <small>{tx('কৃষককে এখন নন-মেম্বার হিসেবে যোগ করে পরে সদস্য করা যায়।')}</small>
                </span>
              </div>
            </section>
          )}

          <div className="ff-row2 ff-main">
            <Section icon={<UserSolid />} title={tx('১. জরুরি তথ্য')}>
              <div className="ff-grid2">
                <Form.Item name="name_bn" label={tx('পূর্ণ নাম')} rules={[required(tx('নাম দিন'))]}>
                  <Input placeholder={tx('পূর্ণ নাম লিখুন')} />
                </Form.Item>
                <Form.Item name="father_name" label={tx('পিতার নাম')} rules={[required(tx('পিতার নাম দিন'))]}>
                  <Input placeholder={tx('পিতার নাম লিখুন')} />
                </Form.Item>
                <Form.Item name="gender" label={tx('লিঙ্গ')} rules={[required(tx('লিঙ্গ বাছাই করুন'))]}>
                  <Select placeholder={tx('লিঙ্গ বাছাই করুন')} options={toOptions(meta?.genders)} />
                </Form.Item>
                <Form.Item name="nid" label={tx('জাতীয় পরিচয়পত্র (NID)')} rules={[digitRule(/^(\d{10}|\d{13}|\d{17})$/, tx('NID ১০, ১৩ বা ১৭ অঙ্কের হতে হবে'))]}>
                  <Input inputMode="numeric" placeholder={tx('NID নম্বর লিখুন')} />
                </Form.Item>
                <Form.Item name="mobile" label={tx('মোবাইল নম্বর')} rules={[digitRule(MOBILE, tx('সঠিক মোবাইল নম্বর দিন'))]}>
                  <Input inputMode="numeric" placeholder={tx('মোবাইল নম্বর লিখুন')} />
                </Form.Item>
              </div>
            </Section>

            <Section
              icon={<EnvironmentFilled />}
              title={tx('২. ঠিকানা')}
              extra={
                !showArea && (
                  <Button size="small" type="link" onClick={() => setShowArea(true)}>
                    {tx('এলাকা বদলান')}
                  </Button>
                )
              }
            >
              {!showArea && <div className="ff-area">{areaLine}</div>}
              <div className="ff-grid2">
                {LEVELS.map((level, i) => (
                  <div key={level.key} className="ff-field" hidden={!showArea && i < 4}>
                    <span>
                      {level.label}
                      {i === 4 && <span className="ff-req"> *</span>}
                    </span>
                    <LevelSelect index={i} parentId={i === 0 ? undefined : path[i - 1]} value={path[i]} onChange={(v) => setLevel(i, v)} placeholder={tx('{{p0}} বাছাই করুন', { p0: level.label })} />
                  </div>
                ))}
                <Form.Item name="mouza_id" label={tx('মৌজা')} rules={[required(tx('মৌজা বাছাই করুন'))]} extra={villageId && mouzas.data?.length === 0 ? tx('এই গ্রামের সাথে কোনো মৌজা যুক্ত নেই — মৌজা পাতায় যুক্ত করুন।') : undefined}>
                  <Select
                    disabled={!villageId}
                    loading={mouzas.isFetching}
                    placeholder={villageId ? tx('মৌজা বাছাই করুন') : tx('আগে গ্রাম বাছাই করুন')}
                    labelRender={(o) => o.label ?? tx('লোড হচ্ছে…')}
                    options={mouzas.data?.map((m) => ({ value: m.id, label: `${nameOf(m)} (JL ${digits(m.jl_no)})` }))}
                  />
                </Form.Item>
              </div>
              <Form.Item name="para" label={tx('বর্তমান ঠিকানা (বাড়ি/পাড়া)')} className="ff-last">
                <Input.TextArea rows={3} maxLength={255} showCount placeholder={tx('পূর্ণ ঠিকানা লিখুন')} />
              </Form.Item>
            </Section>
          </div>

          <button type="button" className={`ff-more-toggle${more ? ' on' : ''}`} onClick={() => setMore((m) => !m)}>
            {more ? <UpOutlined /> : <DownOutlined />}
            {tx('আরও তথ্য (ঐচ্ছিক)')}
            <small>{tx('মাতার নাম, জন্মতারিখ, বিকল্প মোবাইল, ইমেইল, পেশা, ডাকঘর, ছবি ও ডকুমেন্ট, পরিবার, খানা')}</small>
          </button>
          <div className="ff-row3 ff-more" hidden={!more}>
            <Section icon={<FileTextFilled />} title={tx('৩. অতিরিক্ত তথ্য')}>
              <div className="ff-grid3">
                <Form.Item name="mother_name" label={tx('মাতার নাম')}>
                  <Input placeholder={tx('মাতার নাম লিখুন')} />
                </Form.Item>
                <Form.Item name="date_of_birth" label={tx('জন্মতারিখ')} help={isMinor ? tx('সতর্কতা: বয়স ১৮ বছরের কম।') : undefined} validateStatus={isMinor ? 'warning' : undefined}>
                  <DatePicker format="DD-MM-YYYY" placeholder="dd-mm-yyyy" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
                <Form.Item name="alt_mobile" label={tx('বিকল্প মোবাইল')} rules={[digitRule(MOBILE, tx('সঠিক মোবাইল নম্বর দিন'))]}>
                  <Input inputMode="numeric" placeholder={tx('বিকল্প মোবাইল লিখুন')} />
                </Form.Item>
                <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                  <Input type="email" placeholder={tx('ইমেইল ঠিকানা লিখুন')} />
                </Form.Item>
                <Form.Item name="occupation" label={tx('পেশা')}>
                  <Select allowClear placeholder={tx('পেশা বাছাই করুন')} options={toOptions(meta?.occupations)} />
                </Form.Item>
                <Form.Item name="post_office" label={tx('ডাকঘর')}>
                  <Input placeholder={tx('ডাকঘর লিখুন')} />
                </Form.Item>
                <Form.Item name="post_code" label={tx('পোস্ট কোড')} rules={[digitRule(/^\d{4}$/, tx('পোস্ট কোড ৪ অঙ্কের হতে হবে।'))]}>
                  <Input inputMode="numeric" placeholder={tx('পোস্ট কোড লিখুন')} />
                </Form.Item>
                <Form.Item name="blood_group" label={tx('রক্তের গ্রুপ')}>
                  <Select allowClear placeholder={tx('রক্তের গ্রুপ বাছাই করুন')} options={toOptions(meta?.blood_groups)} />
                </Form.Item>
                <Form.Item name="education_level" label={tx('শিক্ষাগত যোগ্যতা')}>
                  <Select allowClear placeholder={tx('শিক্ষাগত যোগ্যতা বাছাই করুন')} options={toOptions(meta?.education_levels)} />
                </Form.Item>
                <Form.Item name="farmer_type" label={tx('কৃষকের ধরন')}>
                  <Select allowClear placeholder={tx('কৃষকের ধরন বাছাই করুন')} options={toOptions(meta?.farmer_types)} />
                </Form.Item>
                <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
                  <Input placeholder="Full name in English" />
                </Form.Item>
                <Form.Item name="spouse_name" label={tx('স্বামী/স্ত্রীর নাম')}>
                  <Input placeholder={tx('স্বামী/স্ত্রীর নাম লিখুন')} />
                </Form.Item>
                <Form.Item name="birth_reg_no" label={tx('জন্ম নিবন্ধন নম্বর')} rules={[digitRule(/^\d{17}$/, tx('১৭ অঙ্কের হতে হবে'))]}>
                  <Input inputMode="numeric" placeholder={tx('NID না থাকলে')} />
                </Form.Item>
              </div>
              <Form.Item name="remarks" label={tx('মন্তব্য')} className="ff-last">
                <Input.TextArea rows={2} maxLength={300} showCount placeholder={tx('অতিরিক্ত নোট লিখুন')} />
              </Form.Item>
            </Section>

            <Section
              icon={<TeamSolid />}
              title={tx('৪. পরিবারের তথ্য')}
              extra={
                <Button type="primary" size="small" icon={<PlusOutlined />} className="ff-add" onClick={() => setFamily((f) => (f.length >= 20 ? f : [...f, ...blankRows(1)]))}>
                  {tx('পরিবারের সদস্য যোগ করুন')}
                </Button>
              }
              className="ff-family"
            >
              <div className="ff-table-wrap">
                <table className="ff-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{tx('নাম')}</th>
                      <th>{tx('সম্পর্ক')}</th>
                      <th>{tx('পেশা')}</th>
                      <th>{tx('মোবাইল')}</th>
                      <th>{tx('অ্যাকশন')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {family.map((r, i) => (
                      <tr key={r.key}>
                        <td>{digits(i + 1)}</td>
                        <td>
                          <Input size="small" value={r.name} placeholder={tx('নাম লিখুন')} maxLength={150} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                        </td>
                        <td>
                          <Select size="small" allowClear value={r.relation} placeholder={tx('সম্পর্ক বাছাই করুন')} options={toOptions(meta?.relations).filter((o) => o.value !== 'self')} onChange={(v) => setRow(r.key, { relation: v })} />
                        </td>
                        <td>
                          <Input size="small" value={r.occupation} placeholder={tx('পেশা লিখুন')} maxLength={100} onChange={(e) => setRow(r.key, { occupation: e.target.value })} />
                        </td>
                        <td>
                          <Input size="small" inputMode="numeric" value={r.mobile} placeholder={tx('মোবাইল লিখুন')} maxLength={11} onChange={(e) => setRow(r.key, { mobile: e.target.value })} />
                        </td>
                        <td>
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={tx('মুছুন')} onClick={() => setFamily((f) => f.filter((x) => x.key !== r.key))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ff-household">
                <span className="ff-household-label">{tx('খানা (Household)')}</span>
                <Radio.Group
                  value={householdMode}
                  onChange={(e) => setHouseholdMode(e.target.value)}
                  options={[{ value: 'none', label: tx('কোনো খানা নয়') }, { value: 'existing', label: tx('বিদ্যমান খানা') }, ...(existing?.household ? [] : [{ value: 'new', label: tx('নতুন খানা (ইনি খানাপ্রধান)') }])]}
                />
                {householdMode === 'existing' && (
                  <div className="ff-household-pick">
                    <Form.Item name="household_id" rules={[required(tx('খানা বাছাই করুন'))]}>
                      <Select
                        showSearch={{ filterOption: false, onSearch: setHouseholdTerm }}
                        loading={households.isFetching}
                        placeholder={tx('খানার কোড বা খানাপ্রধানের নাম')}
                        options={[
                          ...(existing?.household && !households.data?.some((h) => h.id === existing.household!.id) ? [{ value: existing.household.id, label: `${existing.household.code} — ${existing.household.head?.name_bn ?? ''}` }] : []),
                          ...(households.data ?? []).map((h) => ({ value: h.id, label: `${h.code} — ${h.head?.name_bn ?? ''}${h.village ? ', ' + h.village.name_bn : ''}` })),
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="household_relation" rules={[required(tx('সম্পর্ক দিন'))]}>
                      <Select placeholder={tx('খানাপ্রধানের সাথে সম্পর্ক')} options={toOptions(meta?.relations)} />
                    </Form.Item>
                  </div>
                )}
              </div>
            </Section>
            <Section icon={<CameraFilled />} title={tx('৫. ছবি ও ডকুমেন্ট')} className="ff-photo-card">
              <Upload
                className="ff-photo-upload"
                accept="image/png,image/jpeg"
                showUploadList={false}
                beforeUpload={(f) => {
                  if (f.size > 2 * 1024 * 1024) {
                    message.error(tx('ছবি ২MB-এর বেশি।'))
                    return Upload.LIST_IGNORE
                  }
                  setPhoto(f)
                  return false
                }}
              >
                <button type="button" className="ff-photo">
                  <span className="ff-photo-box">
                    {photoPreview ? <img src={photoPreview} alt="" /> : isEdit && existing?.photo_url ? <ProtectedImage url={existing.photo_url} size={132} /> : <UserOutlined className="ff-photo-empty" />}
                    <span className="ff-photo-cam">
                      <CameraFilled />
                    </span>
                  </span>
                  <strong>{tx('কৃষকের ছবি আপলোড')}</strong>
                  <small>{tx('JPG, PNG (সর্বোচ্চ ২MB)')}</small>
                </button>
              </Upload>
              <div className="ff-docs-title">{tx('সহায়ক ডকুমেন্ট')}</div>
              {docSlots.map((d) => (
                <div key={d.slot} className="ff-doc">
                  <FileTextOutlined className="ff-doc-icon" />
                  <span className="ff-doc-label" title={docs[d.slot]?.name}>
                    {d.label}
                    {docs[d.slot] && <small>{docs[d.slot]!.name}</small>}
                  </span>
                  {docs[d.slot] ? (
                    <Button size="small" className="ff-doc-btn" icon={<CloseOutlined />} aria-label={tx('সরান')} onClick={() => setDocs((x) => ({ ...x, [d.slot]: undefined }))} />
                  ) : (
                    <Upload accept=".jpg,.jpeg,.png,.pdf" showUploadList={false} beforeUpload={pickFile(d.slot)}>
                      <Button size="small" className="ff-doc-btn" icon={<UploadOutlined />}>
                        {tx('আপলোড করুন')}
                      </Button>
                    </Upload>
                  )}
                </div>
              ))}
            </Section>
          </div>

          <div className="ff-footer">
            <Button icon={<ReloadOutlined />} onClick={reset}>
              {tx('রিসেট')}
            </Button>
            {canApply && (
              <Checkbox checked={applyAfter} onChange={(e) => setApplyAfter(e.target.checked)}>
                {tx('সংরক্ষণের পর সদস্যপদের আবেদন তৈরি করুন')}
              </Checkbox>
            )}
            {isEdit && (
              <Form.Item name="is_active" valuePropName="checked" noStyle>
                <Checkbox>{tx('সক্রিয়')}</Checkbox>
              </Form.Item>
            )}
            <span className="ff-footer-gap" />
            <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
            <Button type="primary" htmlType="submit" icon={<SaveFilled />} loading={saving}>
              {tx('কৃষক সংরক্ষণ')}
            </Button>
          </div>
        </Form>

        <Modal
          open={!!duplicates}
          width={760}
          title={tx('সম্ভাব্য ডুপ্লিকেট কৃষক')}
          onCancel={() => setDuplicates(null)}
          footer={[
            <Button key="cancel" onClick={() => setDuplicates(null)}>
              {tx('ফিরে যান')}
            </Button>,
            <Button key="save" type="primary" danger loading={saving} onClick={() => save(true)}>
              {tx('ইনি আলাদা ব্যক্তি — সংরক্ষণ করুন')}
            </Button>,
          ]}
        >
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('এই তথ্যের সাথে মিলে যায় এমন কৃষক আগে থেকেই আছেন। একই ব্যক্তি হলে নতুন রেকর্ড না করে আগেরটি খুলুন।')} />
          <DuplicateMatches matches={duplicates ?? []} />
        </Modal>
      </div>
    </ConfigProvider>
  )
}
