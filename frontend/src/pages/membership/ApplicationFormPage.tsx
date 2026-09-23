import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Popconfirm, Radio, Row, Space, Spin, Tag, Upload } from 'antd'
import { MinusCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FarmerPicker from '../../components/FarmerPicker'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { APPLICATION_STATUS, openProtectedFile } from '../../lib/phase2'
import { required } from '../../lib/rules'

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
  status: string
  nominees: Nominee[]
  member: { id: number; member_no: number } | null
  approval_request_id: number | null
  approval_request: { id: number; current_step: number; total_steps: number; status: string } | null
  has_form_scan: boolean
  has_signature: boolean
  creator: { name_bn: string } | null
}

const EDITABLE = ['draft', 'returned']

export default function ApplicationFormPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const isNew = !id
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [scan, setScan] = useState<File | null>(null)
  const [signature, setSignature] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: app, isLoading } = useQuery({
    queryKey: ['membership-applications', id],
    queryFn: async () => (await api.get<Application>(`/membership-applications/${id}`)).data,
    enabled: !isNew,
  })
  const { data: defaults } = useQuery({
    queryKey: ['membership-defaults'],
    queryFn: async () => (await api.get<{ admission_fee: number }>('/membership-applications/defaults')).data,
  })

  const editable = isNew || (app && EDITABLE.includes(app.status) && can(['membership.create', 'membership.edit']))
  const defaultFee = app ? Number(app.default_fee) : defaults?.admission_fee ?? 0

  useEffect(() => {
    if (isNew && defaults) {
      form.setFieldsValue({
        farmer_id: sp.get('farmer') ? Number(sp.get('farmer')) : undefined,
        applied_on: dayjs(),
        admission_fee: defaults.admission_fee,
        fee_status: 'paid',
        nominees: [{ share_percent: 100 }],
      })
    }
  }, [isNew, defaults, form, sp])

  useEffect(() => {
    if (app) {
      form.setFieldsValue({
        ...app,
        applied_on: dayjs(app.applied_on),
        resolution_date: app.resolution_date ? dayjs(app.resolution_date) : null,
        admission_fee: Number(app.admission_fee),
        nominees: app.nominees.map((n) => ({ ...n, share_percent: Number(n.share_percent) })),
      })
    }
  }, [app, form])

  const fee: number | undefined = Form.useWatch('admission_fee', form)
  const nominees: Nominee[] | undefined = Form.useWatch('nominees', form)
  const shareTotal = useMemo(() => (nominees ?? []).reduce((s, n) => s + (Number(n?.share_percent) || 0), 0), [nominees])
  const feeChanged = fee !== undefined && fee !== null && Math.abs(Number(fee) - defaultFee) > 0.001

  const save = async (submit: boolean) => {
    const v = await form.validateFields()
    if (Math.abs(shareTotal - 100) > 0.001) {
      message.error(`নমিনিদের অংশের যোগফল ১০০% হতে হবে (এখন ${digits(shareTotal)}%)।`)
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
    Object.entries(payload).forEach(([k, val]) => val !== undefined && val !== null && fd.append(k, String(val)))
    fd.append(
      'nominees',
      JSON.stringify((v.nominees as Nominee[]).map((n) => ({ ...n, nid: n.nid ? toEnDigits(n.nid) : null, mobile: n.mobile ? toEnDigits(n.mobile) : null }))),
    )
    if (scan) fd.append('form_scan', scan)
    if (signature) fd.append('signature', signature)

    setSaving(true)
    try {
      const r = isNew ? await api.post('/membership-applications', fd) : await api.post(`/membership-applications/${id}`, fd)
      message.success(submit ? 'অনুমোদনের জন্য পাঠানো হয়েছে।' : 'খসড়া সংরক্ষণ হয়েছে।')
      queryClient.invalidateQueries({ queryKey: ['membership-applications'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
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
      message.success('আবেদন বাতিল হয়েছে।')
      queryClient.invalidateQueries({ queryKey: ['membership-applications'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (!isNew && (isLoading || !app)) return <Spin />

  return (
    <>
      <div className="page-header">
        <h2>{isNew ? 'নতুন সদস্যপদ আবেদন' : `আবেদন ${app!.application_no}`}</h2>
        {app && (
          <Space wrap>
            <Tag color={APPLICATION_STATUS[app.status]?.color}>{APPLICATION_STATUS[app.status]?.label}</Tag>
            {app.approval_request_id && (
              <Link to={`/approvals/${app.approval_request_id}`}>
                অনুমোদনের অবস্থা
                {app.approval_request?.status === 'pending' && ` (ধাপ ${digits(app.approval_request.current_step)}/${digits(app.approval_request.total_steps)})`}
              </Link>
            )}
            <Button onClick={() => window.print()} className="no-print">
              আবেদনপত্র প্রিন্ট
            </Button>
          </Space>
        )}
      </div>

      {app?.member && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <>
              সদস্যপদ অনুমোদিত — সদস্য নং <strong>{digits(app.member.member_no)}</strong>।{' '}
              <Link to={`/farmers/${app.farmer_id}`}>প্রোফাইল দেখুন</Link>
            </>
          }
        />
      )}
      {app?.status === 'returned' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="আবেদনটি সংশোধনের জন্য ফেরত এসেছে। কারণ দেখতে 'অনুমোদনের অবস্থা' খুলুন, সংশোধন করে আবার পাঠান।" />}

      {!editable && app ? (
        <Card>
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="কৃষক">
              <Link to={`/farmers/${app.farmer.id}`}>{app.farmer.name_bn}</Link> ({app.farmer.farmer_code})
            </Descriptions.Item>
            <Descriptions.Item label="পিতা">{app.farmer.father_name}</Descriptions.Item>
            <Descriptions.Item label="আবেদনের তারিখ">{fmtDate(app.applied_on)}</Descriptions.Item>
            <Descriptions.Item label="ভর্তি ফি">
              ৳ {digits(Number(app.admission_fee))} ({app.fee_status === 'paid' ? 'পরিশোধিত' : 'বাকি'})
              {Number(app.admission_fee) !== Number(app.default_fee) && <div>নির্ধারিত ৳ {digits(Number(app.default_fee))} — কারণ: {app.fee_override_reason}</div>}
            </Descriptions.Item>
            <Descriptions.Item label="প্রস্তাবক">{app.proposer?.farmer.name_bn ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="সমর্থক">{app.seconder?.farmer.name_bn ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="প্রাথমিক শেয়ার">{app.initial_shares ? digits(app.initial_shares) : '—'}</Descriptions.Item>
            <Descriptions.Item label="সভার সিদ্ধান্ত">{app.resolution_no ? `${app.resolution_no} (${fmtDate(app.resolution_date)})` : '—'}</Descriptions.Item>
            <Descriptions.Item label="নমিনি" span="filled">
              {app.nominees.map((n, i) => (
                <div key={i}>
                  {n.name} — {n.relation}, {digits(Number(n.share_percent))}%{n.nid && `, NID ${digits(n.nid)}`}
                  {n.mobile && `, ${digits(n.mobile)}`}
                </div>
              ))}
            </Descriptions.Item>
            <Descriptions.Item label="সংযুক্তি" span="filled">
              <Space>
                {app.has_form_scan && <Button size="small" onClick={() => openProtectedFile(`/membership-applications/${app.id}/file/form_scan`)}>আবেদনপত্রের স্ক্যান</Button>}
                {app.has_signature && <Button size="small" onClick={() => openProtectedFile(`/membership-applications/${app.id}/file/signature`)}>স্বাক্ষর/টিপসই</Button>}
                {!app.has_form_scan && !app.has_signature && '—'}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="এন্ট্রি করেছেন" span="filled">{app.creator?.name_bn ?? '—'}</Descriptions.Item>
          </Descriptions>
        </Card>
      ) : (
        <Form form={form} layout="vertical">
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="আবেদনকারী">
                <Form.Item name="farmer_id" label="কৃষক (নন-মেম্বার)" rules={[required('কৃষক বাছাই করুন')]}>
                  <FarmerPicker type="non_member" initialLabel={app ? `${app.farmer.name_bn} (${app.farmer.farmer_code})` : undefined} />
                </Form.Item>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="applied_on" label="আবেদনের তারিখ" rules={[required('তারিখ দিন')]}>
                      <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="initial_shares" label="প্রাথমিক শেয়ার (কয়টি)" extra="শুধু তথ্য; শেয়ার হিসাব ফেজ ৬-এ">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="proposer_member_id" label="প্রস্তাবক (সদস্য)">
                      <FarmerPicker type="active_member" valueField="member_id" placeholder="ঐচ্ছিক" initialLabel={app?.proposer?.farmer.name_bn} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="seconder_member_id" label="সমর্থক (সদস্য)">
                      <FarmerPicker type="active_member" valueField="member_id" placeholder="ঐচ্ছিক" initialLabel={app?.seconder?.farmer.name_bn} />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>

              <Card title="নমিনি" style={{ marginTop: 16 }} extra={<Tag color={Math.abs(shareTotal - 100) < 0.001 ? 'green' : 'red'}>মোট {digits(shareTotal)}%</Tag>}>
                <Form.List name="nominees">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Row key={f.key} gutter={8} align="top" style={{ borderBottom: '1px dashed #eee', marginBottom: 8 }}>
                          <Col xs={24} md={7}>
                            <Form.Item name={[f.name, 'name']} label="নাম" rules={[required('নাম দিন')]}>
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col xs={12} md={5}>
                            <Form.Item name={[f.name, 'relation']} label="সম্পর্ক" rules={[required('সম্পর্ক দিন')]}>
                              <Input placeholder="স্ত্রী, পুত্র…" />
                            </Form.Item>
                          </Col>
                          <Col xs={12} md={4}>
                            <Form.Item name={[f.name, 'share_percent']} label="অংশ %" rules={[required('অংশ দিন')]}>
                              <InputNumber min={0.01} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={12} md={4}>
                            <Form.Item name={[f.name, 'nid']} label="NID">
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col xs={10} md={3}>
                            <Form.Item name={[f.name, 'mobile']} label="মোবাইল">
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col xs={2} md={1} style={{ paddingTop: 36 }}>
                            {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="নমিনি সরান" />}
                          </Col>
                        </Row>
                      ))}
                      <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ share_percent: Math.max(0, 100 - shareTotal) || undefined })}>
                        নমিনি যোগ করুন
                      </Button>
                    </>
                  )}
                </Form.List>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Card title="ভর্তি ফি">
                <Form.Item name="admission_fee" label={`ভর্তি ফি (নির্ধারিত ৳ ${digits(defaultFee)})`} rules={[required('ফি দিন')]}>
                  <InputNumber min={0} prefix="৳" style={{ width: '100%' }} />
                </Form.Item>
                {feeChanged && (
                  <Form.Item name="fee_override_reason" label="নির্ধারিত ফি থেকে ভিন্ন হওয়ার কারণ" rules={[required('কারণ লেখা আবশ্যক')]}>
                    <Input.TextArea rows={2} />
                  </Form.Item>
                )}
                <Form.Item name="fee_status" label="ফি পরিশোধ">
                  <Radio.Group options={[{ value: 'paid', label: 'পরিশোধিত' }, { value: 'due', label: 'বাকি' }]} />
                </Form.Item>
              </Card>
              <Card title="সভার সিদ্ধান্ত ও সংযুক্তি (ঐচ্ছিক)" style={{ marginTop: 16 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="resolution_no" label="সিদ্ধান্ত নম্বর">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="resolution_date" label="সভার তারিখ">
                      <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Space orientation="vertical">
                  <Upload accept=".jpg,.jpeg,.png,.pdf" maxCount={1} beforeUpload={(f) => (setScan(f), false)} onRemove={() => setScan(null)}>
                    <Button icon={<UploadOutlined />}>আবেদনপত্রের স্ক্যান {app?.has_form_scan && '(আছে — বদলাতে বাছাই করুন)'}</Button>
                  </Upload>
                  <Upload accept="image/*" maxCount={1} beforeUpload={(f) => (setSignature(f), false)} onRemove={() => setSignature(null)}>
                    <Button icon={<UploadOutlined />}>স্বাক্ষর / টিপসই {app?.has_signature && '(আছে)'}</Button>
                  </Upload>
                </Space>
              </Card>
            </Col>
          </Row>

          <Space style={{ marginTop: 16 }} wrap>
            <Button type="primary" loading={saving} onClick={() => save(true)}>
              অনুমোদনের জন্য পাঠান
            </Button>
            <Button loading={saving} onClick={() => save(false)}>
              খসড়া হিসেবে রাখুন
            </Button>
            {app && (
              <Popconfirm title="আবেদনটি বাতিল করবেন?" okText="হ্যাঁ" cancelText="না" onConfirm={cancelApplication}>
                <Button danger>আবেদন বাতিল</Button>
              </Popconfirm>
            )}
            <Button onClick={() => navigate(-1)}>ফিরে যান</Button>
          </Space>
        </Form>
      )}
    </>
  )
}
