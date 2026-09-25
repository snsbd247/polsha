import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, ConfigProvider, DatePicker, Descriptions, Form, Input, InputNumber, Popconfirm, Radio, Select, Space, Spin, Tag, Upload } from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseOutlined,
  EyeOutlined,
  FileTextFilled,
  HomeOutlined,
  IdcardFilled,
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveFilled,
  TeamOutlined,
  UploadOutlined,
  WarningFilled,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import ProtectedImage from '../../components/ProtectedImage'
import { UserSolid } from '../../components/SideIcons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { APPLICATION_STATUS, openProtectedFile, toOptions, useFarmerMeta } from '../../lib/phase2'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import './application-form.css'

type Nominee = { name: string; relation: string; nid?: string | null; mobile?: string | null; share_percent: number }
type Application = {
  id: number
  application_no: string
  farmer_id: number
  farmer: { id: number; farmer_code: string; name_bn: string; father_name: string }
  applied_on: string
  proposer_member_id: number | null
  seconder_member_id: number | null
  proposer: { farmer: { name_bn: string } } | null
  seconder: { farmer: { name_bn: string } } | null
  admission_fee: string
  default_fee: string
  fee_override_reason: string | null
  fee_status: 'paid' | 'due'
  initial_shares: number | null
  resolution_no: string | null
  resolution_date: string | null
  remarks: string | null
  status: string
  nominees: Nominee[]
  member: { id: number; member_no: number } | null
  approval_request_id: number | null
  approval_request: { id: number; current_step: number; total_steps: number; status: string } | null
  has_form_scan: boolean
  has_signature: boolean
  creator: { name_bn: string } | null
}
type FarmerInfo = {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mother_name: string | null
  mobile: string | null
  nid: string | null
  address: string
  photo_url: string | null
  occupation: string | null
  education_level: string | null
  blood_group: string | null
}
type Doc = { id: number; type: string }
type FileSlot = 'nid_front' | 'nid_back' | 'form_scan' | 'photo' | 'signature'

const EDITABLE = ['draft', 'returned']
const money = (n: number) => '৳ ' + digits(n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

/** Card with the light-blue title band. */
function Section({ icon, title, subtitle, extra, children }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="ma-card">
      <header className="ma-card-head">
        <span className="ma-card-icon">{icon}</span>
        <div className="ma-card-titles">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra}
      </header>
      <div className="ma-card-body">{children}</div>
    </section>
  )
}

/** Upload box: click to choose, shows the chosen file or that one is already on file. */
function UploadTile({ label, accept, file, onFile, adds, onPick, onClear, hint }: { label: string; accept: string; file?: File; onFile?: boolean; adds?: boolean; onPick: (f: File) => void; onClear: () => void; hint: string }) {
  return (
    <div className="ma-tile">
      <span className="ma-tile-label">{label}</span>
      <Upload accept={accept} showUploadList={false} beforeUpload={(f) => (onPick(f), false)} className="ma-tile-upload">
        <button type="button" className={`ma-tile-box ${file ? 'picked' : ''}`}>
          {file ? <CheckCircleFilled className="ma-tile-icon ok" /> : <UploadOutlined className="ma-tile-icon" />}
          <strong>{file ? file.name : onFile ? (adds ? tx('আগে থেকেই আছে — আরেকটি যোগ করতে ক্লিক করুন') : tx('আগে থেকেই আছে — বদলাতে ক্লিক করুন')) : tx('আপলোড করতে ক্লিক করুন')}</strong>
          <small>{hint}</small>
        </button>
      </Upload>
      {file && (
        <button type="button" className="ma-tile-clear" onClick={onClear} aria-label={tx('সরান')}>
          <CloseOutlined />
        </button>
      )}
    </div>
  )
}

export default function ApplicationFormPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const isNew = !id
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useFarmerMeta()
  const [files, setFiles] = useState<Partial<Record<FileSlot, File>>>({})
  const [saving, setSaving] = useState(false)

  const { data: app, isLoading } = useQuery({
    queryKey: ['membership-applications', id],
    queryFn: async () => (await api.get<Application>(`/membership-applications/${id}`)).data,
    enabled: !isNew,
  })
  const { data: defaults } = useQuery({
    queryKey: ['membership-defaults'],
    queryFn: async () => (await api.get<{ admission_fee: number; share_unit_price: number }>('/membership-applications/defaults')).data,
  })

  const editable = isNew || (app && EDITABLE.includes(app.status) && can(['membership.create', 'membership.edit']))
  const defaultFee = app ? Number(app.default_fee) : defaults?.admission_fee ?? 0
  const unit = defaults?.share_unit_price ?? 10

  const initialFarmer = sp.get('farmer') ? Number(sp.get('farmer')) : undefined
  const blank = () => ({
    farmer_id: initialFarmer,
    membership_type: 'general',
    applied_on: dayjs(),
    admission_fee: defaults?.admission_fee ?? 0,
    fee_status: 'paid',
    initial_shares: undefined,
    nominees: [{ share_percent: 100 }],
  })
  useEffect(() => {
    if (isNew && defaults) form.setFieldsValue(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, defaults])
  const loadApp = (a: Application) =>
    form.setFieldsValue({
      ...a,
      membership_type: 'general',
      applied_on: dayjs(a.applied_on),
      resolution_date: a.resolution_date ? dayjs(a.resolution_date) : null,
      admission_fee: Number(a.admission_fee),
      nominees: a.nominees.map((n) => ({ ...n, share_percent: Number(n.share_percent) })),
    })
  useEffect(() => {
    if (app) loadApp(app)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app])

  const farmerId: number | undefined = Form.useWatch('farmer_id', form)
  const fee: number | undefined = Form.useWatch('admission_fee', form)
  const shares: number | undefined = Form.useWatch('initial_shares', form)
  const appliedOn: Dayjs | undefined = Form.useWatch('applied_on', form)
  const nominees: Nominee[] | undefined = Form.useWatch('nominees', form)
  const shareTotal = useMemo(() => (nominees ?? []).reduce((s, n) => s + (Number(n?.share_percent) || 0), 0), [nominees])
  const feeChanged = fee !== undefined && fee !== null && Math.abs(Number(fee) - defaultFee) > 0.001

  const farmer = useQuery({
    queryKey: ['farmers', String(farmerId)],
    queryFn: async () => (await api.get<FarmerInfo>(`/farmers/${farmerId}`)).data,
    enabled: !!farmerId && can('farmer.view'),
  })
  const docs = useQuery({
    queryKey: ['farmers', farmerId, 'documents'],
    queryFn: async () => (await api.get<Doc[]>(`/farmers/${farmerId}/documents`)).data,
    enabled: !!farmerId && can('farmer.view'),
  })
  // the farmer's saved details fill the profile fields the first time they are chosen
  useEffect(() => {
    const f = farmer.data
    if (!f) return
    ;(['occupation', 'education_level', 'blood_group'] as const).forEach((k) => {
      if (!form.getFieldValue(k) && f[k]) form.setFieldValue(k, f[k])
    })
  }, [farmer.data, form])

  const shareAmount = (Number(shares) || 0) * unit
  const totalAmount = (Number(fee) || 0) + shareAmount
  const hasDoc = (t: string) => !!docs.data?.some((d) => d.type === t)
  const nomineesOk = Math.abs(shareTotal - 100) < 0.001 && (nominees ?? []).every((n) => n?.name && n?.relation)
  const stepDone = [!!farmerId, !!appliedOn && fee !== undefined && fee !== null && nomineesOk, !!files.form_scan || !!app?.has_form_scan]
  const current = stepDone.findIndex((d) => !d) === -1 ? 3 : stepDone.findIndex((d) => !d)

  const save = async (submit: boolean) => {
    const v = await form.validateFields()
    if (Math.abs(shareTotal - 100) > 0.001) {
      message.error(tx('নমিনিদের অংশের যোগফল ১০০% হতে হবে (এখন {{p0}}%)।', { p0: digits(shareTotal) }))
      return
    }
    const fd = new FormData()
    const payload: Record<string, unknown> = {
      ...v,
      applied_on: (v.applied_on as Dayjs).format('YYYY-MM-DD'),
      resolution_date: v.resolution_date ? (v.resolution_date as Dayjs).format('YYYY-MM-DD') : '',
      submit: submit ? 1 : 0,
    }
    delete payload.nominees
    delete payload.membership_type
    Object.entries(payload).forEach(([k, val]) => val !== undefined && val !== null && fd.append(k, String(val)))
    fd.append(
      'nominees',
      JSON.stringify((v.nominees as Nominee[]).map((n) => ({ ...n, nid: n.nid ? toEnDigits(n.nid) : null, mobile: n.mobile ? toEnDigits(n.mobile) : null }))),
    )
    Object.entries(files).forEach(([slot, file]) => file && fd.append(slot, file))

    setSaving(true)
    try {
      const r = isNew ? await api.post('/membership-applications', fd) : await api.post(`/membership-applications/${id}`, fd)
      message.success(submit ? tx('অনুমোদনের জন্য পাঠানো হয়েছে।') : tx('খসড়া সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['membership-applications'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
      setFiles({})
      navigate(`/membership/applications/${r.data.id}`, { replace: true })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const cancelApplication = async () => {
    try {
      await api.post(`/membership-applications/${id}/cancel`)
      message.success(tx('আবেদন বাতিল হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['membership-applications'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const reset = () => {
    form.resetFields()
    if (app) loadApp(app)
    else form.setFieldsValue(blank())
    setFiles({})
  }

  if (!isNew && (isLoading || !app)) return <Spin />

  // submitted / decided applications are shown read-only
  if (!editable && app) {
    return (
      <>
        <div className="page-header">
          <h2>{tx('আবেদন {{p0}}', { p0: app.application_no })}</h2>
          <Space wrap>
            <Tag color={APPLICATION_STATUS[app.status]?.color}>{APPLICATION_STATUS[app.status]?.label}</Tag>
            {app.approval_request_id && (
              <Link to={`/approvals/${app.approval_request_id}`}>
                {tx('অনুমোদনের অবস্থা')}
                {app.approval_request?.status === 'pending' && tx(' (ধাপ {{p0}}/{{p1}})', { p0: digits(app.approval_request.current_step), p1: digits(app.approval_request.total_steps) })}
              </Link>
            )}
            <Button onClick={() => window.print()} className="no-print">
              {tx('আবেদনপত্র প্রিন্ট')}
            </Button>
          </Space>
        </div>
        {app.member && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            title={
              <>
                {tx('সদস্যপদ অনুমোদিত — সদস্য নং')}{' '}<strong>{digits(app.member.member_no)}</strong>।{' '}
                <Link to={`/farmers/${app.farmer_id}`}>{tx('প্রোফাইল দেখুন')}</Link>
              </>
            }
          />
        )}
        <Card>
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={tx('কৃষক')}>
              <Link to={`/farmers/${app.farmer.id}`}>{app.farmer.name_bn}</Link> ({app.farmer.farmer_code})
            </Descriptions.Item>
            <Descriptions.Item label={tx('পিতা')}>{app.farmer.father_name}</Descriptions.Item>
            <Descriptions.Item label={tx('আবেদনের তারিখ')}>{fmtDate(app.applied_on)}</Descriptions.Item>
            <Descriptions.Item label={tx('ভর্তি ফি')}>
              {tx('৳')}{' '}{digits(Number(app.admission_fee))} ({app.fee_status === 'paid' ? tx('পরিশোধিত') : tx('বাকি')})
              {Number(app.admission_fee) !== Number(app.default_fee) && <div>{tx('নির্ধারিত ৳')}{' '}{digits(Number(app.default_fee))}{' '}{tx('— কারণ:')}{' '}{app.fee_override_reason}</div>}
            </Descriptions.Item>
            <Descriptions.Item label={tx('প্রস্তাবক')}>{app.proposer?.farmer.name_bn ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('সমর্থক')}>{app.seconder?.farmer.name_bn ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('প্রাথমিক শেয়ার')}>{app.initial_shares ? digits(app.initial_shares) : '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('সভার সিদ্ধান্ত')}>{app.resolution_no ? `${app.resolution_no} (${fmtDate(app.resolution_date)})` : '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('নমিনি')} span="filled">
              {app.nominees.map((n, i) => (
                <div key={i}>
                  {n.name} — {n.relation}, {digits(Number(n.share_percent))}%{n.nid && `, NID ${digits(n.nid)}`}
                  {n.mobile && `, ${digits(n.mobile)}`}
                </div>
              ))}
            </Descriptions.Item>
            <Descriptions.Item label={tx('মন্তব্য')} span="filled">{app.remarks || '—'}</Descriptions.Item>
            <Descriptions.Item label={tx('সংযুক্তি')} span="filled">
              <Space>
                {app.has_form_scan && <Button size="small" onClick={() => openProtectedFile(`/membership-applications/${app.id}/file/form_scan`)}>{tx('আবেদনপত্রের স্ক্যান')}</Button>}
                {app.has_signature && <Button size="small" onClick={() => openProtectedFile(`/membership-applications/${app.id}/file/signature`)}>{tx('স্বাক্ষর/টিপসই')}</Button>}
                {!app.has_form_scan && !app.has_signature && '—'}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={tx('এন্ট্রি করেছেন')} span="filled">{app.creator?.name_bn ?? '—'}</Descriptions.Item>
          </Descriptions>
        </Card>
      </>
    )
  }

  const f = farmer.data
  const steps = [
    { title: tx('কৃষকের তথ্য'), sub: tx('বিদ্যমান কৃষক বাছাই বা নতুন যোগ') },
    { title: tx('সদস্যপদের বিবরণ'), sub: tx('সদস্যপদের ধরন, ফি, শেয়ার') },
    { title: tx('ডকুমেন্ট'), sub: tx('প্রয়োজনীয় ডকুমেন্ট আপলোড') },
    { title: tx('যাচাই ও জমা'), sub: tx('তথ্য যাচাই করে জমা দিন') },
  ]
  const setFile = (slot: FileSlot) => (file?: File) => setFiles((x) => ({ ...x, [slot]: file }))
  const statusLabel = app ? APPLICATION_STATUS[app.status]?.label : tx('খসড়া')

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="ma">
        <div className="ma-top">
          <nav className="ma-crumb">
            <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
              <HomeOutlined />
            </Link>
            <RightOutlined className="ma-crumb-sep" />
            <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
            <RightOutlined className="ma-crumb-sep" />
            <Link to="/membership/applications">{tx('সদস্যপদ আবেদন')}</Link>
            <RightOutlined className="ma-crumb-sep" />
            <span>{isNew ? tx('নতুন সদস্যপদ আবেদন') : app!.application_no}</span>
          </nav>
          <Button icon={<ArrowLeftOutlined />} className="ma-back" onClick={() => navigate('/membership/applications')}>
            {tx('আবেদন তালিকায় ফিরুন')}
          </Button>
        </div>
        <div className="ma-head">
          <h1>{isNew ? tx('নতুন সদস্যপদ আবেদন') : tx('আবেদন {{p0}}', { p0: app!.application_no })}</h1>
          <p>{tx('সদস্যপদের আবেদন ফর্ম পূরণ করুন। কৃষকের তথ্য সদস্যপদের রেকর্ডের সাথে যুক্ত হবে।')}</p>
        </div>

        {app?.status === 'returned' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('আবেদনটি সংশোধনের জন্য ফেরত এসেছে। কারণ দেখতে \'অনুমোদনের অবস্থা\' খুলুন, সংশোধন করে আবার পাঠান।')} />}

        <ol className="ma-steps">
          {steps.map((s, i) => (
            <li key={i} className={i === current ? 'current' : stepDone[i] ? 'done' : ''}>
              <span className="ma-step-no">{stepDone[i] && i !== current ? <CheckCircleFilled /> : digits(i + 1)}</span>
              <span className="ma-step-text">
                <strong>{s.title}</strong>
                <small>{s.sub}</small>
              </span>
            </li>
          ))}
        </ol>

        <Form form={form} layout="vertical" requiredMark={(label, { required: r }) => (r ? <>{label} <span className="ma-req">*</span></> : label)}>
          <div className="ma-grid">
            <div className="ma-main">
              <Section
                icon={<UserSolid />}
                title={tx('১. কৃষক বাছাই')}
                subtitle={tx('বিদ্যমান কৃষক খুঁজে বাছাই করুন। না পেলে নতুন কৃষক যোগ করুন।')}
                extra={
                  can('farmer.create') && (
                    <Button icon={<PlusOutlined />} className="ma-outline" onClick={() => navigate('/farmers/new')}>
                      {tx('নতুন কৃষক যোগ করুন')}
                    </Button>
                  )
                }
              >
                <Form.Item name="farmer_id" label={tx('কৃষক খুঁজুন')} rules={[required(tx('কৃষক বাছাই করুন'))]} className="ma-search">
                  <FarmerPicker type="non_member" placeholder={tx('নাম, মোবাইল, NID বা Farmer ID দিয়ে খুঁজুন...')} initialLabel={app ? `${app.farmer.name_bn} (${app.farmer.farmer_code})` : undefined} />
                </Form.Item>
                {farmerId && f && (
                  <div className="ma-farmer">
                    <div className="ma-farmer-photo">{f.photo_url ? <ProtectedImage url={f.photo_url} size={116} /> : <UserSolid className="ma-farmer-empty" />}</div>
                    <div className="ma-farmer-body">
                      <div className="ma-farmer-name">
                        <h4>{nameOf(f)}</h4>
                        <span className="ma-pill green">{tx('নিবন্ধিত কৃষক')}</span>
                        <Button size="small" icon={<EyeOutlined />} className="ma-outline ma-view" onClick={() => window.open(`/farmers/${f.id}`, '_blank')}>
                          {tx('সম্পূর্ণ প্রোফাইল')}
                        </Button>
                      </div>
                      <div className="ma-farmer-cols">
                        <dl>
                          <dt>{tx('কৃষক আইডি')}</dt>
                          <dd>{f.farmer_code}</dd>
                          <dt>{tx('মোবাইল')}</dt>
                          <dd>{digits(f.mobile) || '—'}</dd>
                          <dt>NID</dt>
                          <dd>{digits(f.nid) || '—'}</dd>
                        </dl>
                        <dl>
                          <dt>{tx('পিতার নাম')}</dt>
                          <dd>{f.father_name}</dd>
                          <dt>{tx('মাতার নাম')}</dt>
                          <dd>{f.mother_name || '—'}</dd>
                          <dt>{tx('ঠিকানা')}</dt>
                          <dd>{f.address}</dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                )}
              </Section>

              <Section icon={<IdcardFilled />} title={tx('২. সদস্যপদের বিবরণ')}>
                <div className="ma-details">
                  <div className="ma-details-left">
                    <div className="ma-g2">
                      <Form.Item name="membership_type" label={tx('সদস্যপদের ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
                        <Select options={[{ value: 'general', label: tx('সাধারণ সদস্য') }]} />
                      </Form.Item>
                      <Form.Item name="applied_on" label={tx('আবেদনের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                        <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                      </Form.Item>
                    </div>
                    <div className="ma-g3">
                      <Form.Item name="admission_fee" label={tx('ভর্তি ফি')} rules={[required(tx('ফি দিন'))]} tooltip={tx('নির্ধারিত ৳ {{p0}}', { p0: digits(defaultFee) })}>
                        <InputNumber min={0} prefix="৳" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label={tx('প্রতি শেয়ারের মূল্য')} tooltip={tx('সিস্টেম পছন্দসমূহে ঠিক করা হয়।')}>
                        <InputNumber value={unit} prefix="৳" disabled style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name="initial_shares" label={tx('শেয়ারের সংখ্যা')}>
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="0" />
                      </Form.Item>
                    </div>
                    {feeChanged && (
                      <Form.Item name="fee_override_reason" label={tx('নির্ধারিত ফি থেকে ভিন্ন হওয়ার কারণ')} rules={[required(tx('কারণ লেখা আবশ্যক'))]}>
                        <Input placeholder={tx('কারণ লিখুন')} />
                      </Form.Item>
                    )}
                    <div className="ma-g2 ma-totals">
                      <div className="ma-field">
                        <span>{tx('মোট শেয়ারের টাকা')}</span>
                        <InputNumber value={shareAmount} prefix="৳" disabled style={{ width: '100%' }} />
                      </div>
                      <div className="ma-total-box">
                        <span>{tx('সদস্যপদের মোট টাকা')}</span>
                        <strong>{money(totalAmount)}</strong>
                      </div>
                    </div>
                    <Form.Item name="fee_status" label={tx('ফি পরিশোধ')} className="ma-last">
                      <Radio.Group options={[{ value: 'paid', label: tx('পরিশোধিত') }, { value: 'due', label: tx('বাকি') }]} />
                    </Form.Item>
                  </div>
                  <div className="ma-details-right">
                    <div className="ma-field">
                      <span>{tx('প্রস্তাবিত সদস্য নং')}</span>
                      <Input disabled value={tx('অনুমোদনের পর স্বয়ংক্রিয়ভাবে হবে')} />
                    </div>
                    <div className="ma-g3">
                      <Form.Item name="occupation" label={tx('পেশা')}>
                        <Select allowClear placeholder={tx('বাছাই করুন')} options={toOptions(meta?.occupations)} />
                      </Form.Item>
                      <Form.Item name="education_level" label={tx('শিক্ষাগত যোগ্যতা')}>
                        <Select allowClear placeholder={tx('বাছাই করুন')} options={toOptions(meta?.education_levels)} />
                      </Form.Item>
                      <Form.Item name="blood_group" label={tx('রক্তের গ্রুপ')}>
                        <Select allowClear placeholder={tx('বাছাই করুন')} options={toOptions(meta?.blood_groups)} />
                      </Form.Item>
                    </div>
                    <Form.Item name="remarks" label={tx('মন্তব্য')} className="ma-last">
                      <Input.TextArea rows={3} maxLength={300} showCount placeholder={tx('অতিরিক্ত তথ্য লিখুন...')} />
                    </Form.Item>
                  </div>
                </div>
              </Section>

              <Section icon={<TeamOutlined />} title={tx('৩. নমিনি ও প্রস্তাবক')} extra={<span className={`ma-pill ${Math.abs(shareTotal - 100) < 0.001 ? 'green' : 'red'}`}>{tx('মোট')}{' '}{digits(shareTotal)}%</span>}>
                <Form.List name="nominees">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((fl) => (
                        <div key={fl.key} className="ma-nominee">
                          <Form.Item name={[fl.name, 'name']} label={tx('নমিনির নাম')} rules={[required(tx('নাম দিন'))]}>
                            <Input />
                          </Form.Item>
                          <Form.Item name={[fl.name, 'relation']} label={tx('সম্পর্ক')} rules={[required(tx('সম্পর্ক দিন'))]}>
                            <Input placeholder={tx('স্ত্রী, পুত্র…')} />
                          </Form.Item>
                          <Form.Item name={[fl.name, 'share_percent']} label={tx('অংশ %')} rules={[required(tx('অংশ দিন'))]}>
                            <InputNumber min={0.01} max={100} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item name={[fl.name, 'nid']} label="NID">
                            <Input />
                          </Form.Item>
                          <Form.Item name={[fl.name, 'mobile']} label={tx('মোবাইল')}>
                            <Input />
                          </Form.Item>
                          <span className="ma-nominee-del">{fields.length > 1 && <MinusCircleOutlined onClick={() => remove(fl.name)} aria-label={tx('নমিনি সরান')} />}</span>
                        </div>
                      ))}
                      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ share_percent: Math.max(0, 100 - shareTotal) || undefined })}>
                        {tx('নমিনি যোগ করুন')}
                      </Button>
                    </>
                  )}
                </Form.List>
                <div className="ma-g4 ma-proposer">
                  <Form.Item name="proposer_member_id" label={tx('প্রস্তাবক (সদস্য)')}>
                    <FarmerPicker type="active_member" valueField="member_id" placeholder={tx('ঐচ্ছিক')} initialLabel={app?.proposer?.farmer.name_bn} />
                  </Form.Item>
                  <Form.Item name="seconder_member_id" label={tx('সমর্থক (সদস্য)')}>
                    <FarmerPicker type="active_member" valueField="member_id" placeholder={tx('ঐচ্ছিক')} initialLabel={app?.seconder?.farmer.name_bn} />
                  </Form.Item>
                  <Form.Item name="resolution_no" label={tx('সভার সিদ্ধান্ত নম্বর')}>
                    <Input placeholder={tx('ঐচ্ছিক')} />
                  </Form.Item>
                  <Form.Item name="resolution_date" label={tx('সভার তারিখ')}>
                    <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              </Section>

              <Section icon={<FileTextFilled />} title={tx('৪. সহায়ক ডকুমেন্ট')}>
                <div className="ma-tiles">
                  <UploadTile label={tx('NID কার্ড (সামনে)')} accept=".jpg,.jpeg,.png,.pdf" file={files.nid_front} onFile={hasDoc('nid_front')} adds onPick={setFile('nid_front')} onClear={() => setFile('nid_front')()} hint={tx('JPG, PNG বা PDF (সর্বোচ্চ ৫MB)')} />
                  <UploadTile label={tx('NID কার্ড (পেছনে)')} accept=".jpg,.jpeg,.png,.pdf" file={files.nid_back} onFile={hasDoc('nid_back')} adds onPick={setFile('nid_back')} onClear={() => setFile('nid_back')()} hint={tx('JPG, PNG বা PDF (সর্বোচ্চ ৫MB)')} />
                  <UploadTile label={tx('সদস্যপদ ফর্ম (স্বাক্ষরিত)')} accept=".jpg,.jpeg,.png,.pdf" file={files.form_scan} onFile={!!app?.has_form_scan} onPick={setFile('form_scan')} onClear={() => setFile('form_scan')()} hint={tx('JPG, PNG বা PDF (সর্বোচ্চ ৫MB)')} />
                  <UploadTile label={tx('ছবি')} accept="image/png,image/jpeg" file={files.photo} onFile={!!f?.photo_url} onPick={setFile('photo')} onClear={() => setFile('photo')()} hint={tx('JPG বা PNG (সর্বোচ্চ ২MB)')} />
                  <UploadTile label={tx('স্বাক্ষর / টিপসই')} accept="image/png,image/jpeg" file={files.signature} onFile={!!app?.has_signature} onPick={setFile('signature')} onClear={() => setFile('signature')()} hint={tx('JPG বা PNG (সর্বোচ্চ ২MB)')} />
                </div>
              </Section>
            </div>

            <aside className="ma-side">
              <section className="ma-side-card ma-fee">
                <h3>
                  <FileTextFilled /> {tx('ফি সারাংশ')}
                </h3>
                <div className="ma-fee-row">
                  <span>{tx('ভর্তি ফি')}</span>
                  <span>{money(Number(fee) || 0)}</span>
                </div>
                <div className="ma-fee-row">
                  <span>{tx('শেয়ারের টাকা ({{p0}} × {{p1}})', { p0: digits(Number(shares) || 0), p1: money(unit) })}</span>
                  <span>{money(shareAmount)}</span>
                </div>
                <div className="ma-fee-total">
                  <span>{tx('মোট টাকা')}</span>
                  <strong>{money(totalAmount)}</strong>
                </div>
              </section>

              <section className="ma-side-card ma-notes">
                <h3>
                  <WarningFilled /> {tx('গুরুত্বপূর্ণ তথ্য')}
                </h3>
                <ul>
                  <li>{tx('অনুমোদনের পর এই কৃষক সদস্য হিসেবে নিবন্ধিত হবেন।')}</li>
                  <li>{tx('সদস্য নম্বর স্বয়ংক্রিয়ভাবে তৈরি হবে।')}</li>
                  <li>{tx('অনুমোদনের আগে ভর্তি ফি ও প্রাথমিক শেয়ারের টাকা আদায় করুন।')}</li>
                  <li>{tx('অনুমোদনের জন্য পাঠানোর আগে NID ও স্বাক্ষরিত ফর্ম আপলোড করুন।')}</li>
                  <li>{tx('আবেদনের অবস্থা আবেদন তালিকা থেকে দেখা যাবে।')}</li>
                </ul>
              </section>

              <section className="ma-side-card ma-preview">
                <h3>
                  <EyeOutlined /> {tx('প্রিভিউ')}
                </h3>
                <dl>
                  <dt>{tx('আবেদনকারী কৃষক')}</dt>
                  <dd>{f ? `${nameOf(f)} (${f.farmer_code})` : '—'}</dd>
                  <dt>{tx('সদস্যপদের ধরন')}</dt>
                  <dd>{tx('সাধারণ সদস্য')}</dd>
                  <dt>{tx('আবেদনের তারিখ')}</dt>
                  <dd>{appliedOn ? fmtDate(appliedOn.format('YYYY-MM-DD')) : '—'}</dd>
                  <dt>{tx('ভর্তি ফি')}</dt>
                  <dd>{money(Number(fee) || 0)}</dd>
                  <dt>{tx('প্রাথমিক শেয়ার')}</dt>
                  <dd>{tx('{{p0}} শেয়ার ({{p1}})', { p0: digits(Number(shares) || 0), p1: money(shareAmount) })}</dd>
                  <dt>{tx('মোট টাকা')}</dt>
                  <dd>{money(totalAmount)}</dd>
                  <dt>{tx('অবস্থা')}</dt>
                  <dd>
                    <span className="ma-pill gold">{statusLabel}</span>
                  </dd>
                </dl>
              </section>
            </aside>
          </div>

          <div className="ma-footer">
            <Button icon={<ReloadOutlined />} onClick={reset}>
              {tx('রিসেট')}
            </Button>
            {app && (
              <Popconfirm title={tx('আবেদনটি বাতিল করবেন?')} okText={tx('হ্যাঁ')} cancelText={tx('না')} onConfirm={cancelApplication}>
                <Button danger>{tx('আবেদন বাতিল')}</Button>
              </Popconfirm>
            )}
            <span className="ma-footer-gap" />
            <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
            <Button loading={saving} icon={<SaveFilled />} onClick={() => save(false)}>
              {tx('খসড়া সংরক্ষণ')}
            </Button>
            <Button type="primary" loading={saving} icon={<SaveFilled />} onClick={() => save(true)}>
              {tx('আবেদন জমা দিন')}
            </Button>
          </div>
        </Form>
      </div>
    </ConfigProvider>
  )
}
