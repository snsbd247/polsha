import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Form, Input, Modal, Radio, Row, Select, Space, Spin, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DuplicateMatches from '../../components/DuplicateMatches'
import LocationCascader, { type LocationPath } from '../../components/LocationCascader'
import ProtectedImage from '../../components/ProtectedImage'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { toEnDigits } from '../../lib/format'
import { toOptions, useFarmerMeta, type DuplicateMatch } from '../../lib/phase2'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type FarmerDetail = Record<string, unknown> & {
  id: number
  farmer_code: string
  photo_url: string | null
  location_path: number[]
  household: { id: number; code: string; head: { name_bn: string } | null } | null
}

type Household = { id: number; code: string; head: { name_bn: string } | null; village: { name_bn: string } | null }

const digitRule = (re: RegExp, message: string) => ({
  validator: (_: unknown, v?: string) => (!v || re.test(toEnDigits(v)) ? Promise.resolve() : Promise.reject(new Error(message))),
})

export default function FarmerFormPage() {
  const { id } = useParams()
  const { data: existing, isLoading } = useQuery({
    queryKey: ['farmers', id],
    queryFn: async () => (await api.get<FarmerDetail>(`/farmers/${id}`)).data,
    enabled: !!id,
  })

  if (id && (isLoading || !existing)) return <Spin />
  return <FarmerForm key={id ?? 'new'} id={id} existing={existing} />
}

function FarmerForm({ id, existing }: { id?: string; existing?: FarmerDetail }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useFarmerMeta()
  const [path, setPath] = useState<LocationPath>(() => existing?.location_path ?? [])
  const [photo, setPhoto] = useState<File | null>(null)
  const [householdMode, setHouseholdMode] = useState<'none' | 'existing' | 'new'>(() => (existing?.household ? 'existing' : 'none'))
  const [householdTerm, setHouseholdTerm] = useState('')
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [saving, setSaving] = useState(false)

  const initialValues = useMemo(
    () =>
      existing
        ? { ...existing, date_of_birth: existing.date_of_birth ? dayjs(String(existing.date_of_birth)) : null }
        : { gender: 'male', is_active: true },
    [existing],
  )

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

  const buildBody = (values: Record<string, unknown>, confirm: boolean) => {
    const fd = new FormData()
    const payload: Record<string, unknown> = {
      ...values,
      village_id: villageId,
      date_of_birth: values.date_of_birth ? (values.date_of_birth as Dayjs).format('YYYY-MM-DD') : '',
      household_id: householdMode === 'existing' ? values.household_id : '',
      household_relation: householdMode === 'existing' ? values.household_relation : '',
      new_household: householdMode === 'new' ? 1 : 0,
      confirm_duplicate: confirm ? 1 : 0,
    }
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    })
    if (photo) fd.append('photo', photo)
    return fd
  }

  const save = async (confirm = false) => {
    const values = await form.validateFields()
    if (!villageId) {
      message.error(tx('গ্রাম বাছাই করুন।'))
      return
    }
    setSaving(true)
    try {
      const body = buildBody(values, confirm)
      const r = isEdit ? await api.post(`/farmers/${id}`, body) : await api.post('/farmers', body)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['farmers'] })
      setDuplicates(null)
      navigate(`/farmers/${r.data.id}`)
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

  return (
    <>
      <div className="page-header">
        <h2>{isEdit ? tx('কৃষক সম্পাদনা — {{p0}}', { p0: existing?.farmer_code }) : tx('নতুন কৃষক')}</h2>
      </div>
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={() => save(false)}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card title={tx('ক. ব্যক্তিগত তথ্য')}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="name_bn" label={tx('নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="name_en" label={tx('নাম (ইংরেজি)')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="father_name" label={tx('পিতার নাম')} rules={[required(tx('পিতার নাম দিন'))]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="mother_name" label={tx('মাতার নাম')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="spouse_name" label={tx('স্বামী/স্ত্রীর নাম')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="gender" label={tx('লিঙ্গ')} rules={[required(tx('লিঙ্গ বাছাই করুন'))]}>
                    <Radio.Group options={toOptions(meta?.genders)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="date_of_birth"
                    label={tx('জন্মতারিখ')}
                    help={isMinor ? tx('সতর্কতা: বয়স ১৮ বছরের কম।') : undefined}
                    validateStatus={isMinor ? 'warning' : undefined}
                  >
                    <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="nid" label="NID" rules={[digitRule(/^(\d{10}|\d{13}|\d{17})$/, tx('NID ১০, ১৩ বা ১৭ অঙ্কের হতে হবে'))]}>
                    <Input inputMode="numeric" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="birth_reg_no" label={tx('জন্ম নিবন্ধন নম্বর')} extra={tx('NID না থাকলে')} rules={[digitRule(/^\d{17}$/, tx('১৭ অঙ্কের হতে হবে'))]}>
                    <Input inputMode="numeric" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="mobile" label={tx('মোবাইল')} rules={[digitRule(/^01[3-9]\d{8}$/, tx('সঠিক মোবাইল নম্বর দিন'))]}>
                    <Input inputMode="numeric" placeholder="01XXXXXXXXX" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="alt_mobile" label={tx('বিকল্প মোবাইল')} rules={[digitRule(/^01[3-9]\d{8}$/, tx('সঠিক মোবাইল নম্বর দিন'))]}>
                    <Input inputMode="numeric" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label={tx('ছবি')} extra={tx('সর্বোচ্চ ২MB; স্বয়ংক্রিয়ভাবে ছোট করা হবে')}>
                    <Space>
                      {isEdit && !photo && <ProtectedImage url={existing?.photo_url ?? null} size={48} />}
                      <Upload
                        accept="image/*"
                        maxCount={1}
                        beforeUpload={(f) => {
                          if (f.size > 2 * 1024 * 1024) {
                            message.error(tx('ছবি ২MB-এর বেশি।'))
                            return Upload.LIST_IGNORE
                          }
                          setPhoto(f)
                          return false
                        }}
                        onRemove={() => setPhoto(null)}
                      >
                        <Button icon={<UploadOutlined />}>{tx('ছবি বাছাই')}</Button>
                      </Upload>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card title={tx('খ. ঠিকানা')}>
              <Form.Item label={tx('বিভাগ → জেলা → উপজেলা → ইউনিয়ন → গ্রাম')} required>
                <LocationCascader
                  value={path}
                  onChange={(v) => {
                    setPath(v)
                    form.setFieldValue('mouza_id', undefined)
                  }}
                />
              </Form.Item>
              <Form.Item
                name="mouza_id"
                label={tx('মৌজা')}
                rules={[required(tx('মৌজা বাছাই করুন'))]}
                extra={villageId && mouzas.data?.length === 0 ? tx('এই গ্রামের সাথে কোনো মৌজা যুক্ত নেই — মৌজা পাতায় যুক্ত করুন।') : undefined}
              >
                <Select
                  disabled={!villageId}
                  loading={mouzas.isFetching}
                  placeholder={villageId ? tx('মৌজা বাছাই করুন') : tx('আগে গ্রাম বাছাই করুন')}
                  options={mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))}
                />
              </Form.Item>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="para" label={tx('বাড়ি/পাড়া')}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="post_office" label={tx('ডাকঘর')}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card title={tx('গ. খানা (Household)')} style={{ marginTop: 16 }}>
              <Radio.Group
                value={householdMode}
                onChange={(e) => setHouseholdMode(e.target.value)}
                style={{ marginBottom: 12 }}
                options={[
                  { value: 'none', label: tx('কোনো খানা নয়') },
                  { value: 'existing', label: tx('বিদ্যমান খানা') },
                  ...(existing?.household ? [] : [{ value: 'new', label: tx('নতুন খানা (ইনি খানাপ্রধান)') }]),
                ]}
              />
              {householdMode === 'existing' && (
                <Row gutter={16}>
                  <Col xs={24} md={14}>
                    <Form.Item name="household_id" label={tx('খানা')} rules={[required(tx('খানা বাছাই করুন'))]}>
                      <Select
                        showSearch={{ filterOption: false, onSearch: setHouseholdTerm }}
                        loading={households.isFetching}
                        placeholder={tx('খানার কোড বা খানাপ্রধানের নাম')}
                        options={[
                          ...(existing?.household && !households.data?.some((h) => h.id === existing.household!.id)
                            ? [{ value: existing.household.id, label: `${existing.household.code} — ${existing.household.head?.name_bn ?? ''}` }]
                            : []),
                          ...(households.data ?? []).map((h) => ({ value: h.id, label: `${h.code} — ${h.head?.name_bn ?? ''}${h.village ? ', ' + h.village.name_bn : ''}` })),
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item name="household_relation" label={tx('খানাপ্রধানের সাথে সম্পর্ক')} rules={[required(tx('সম্পর্ক দিন'))]}>
                      <Select options={toOptions(meta?.relations)} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>

            <Card title={tx('ঘ. অন্যান্য')} style={{ marginTop: 16 }}>
              <Form.Item name="occupation" label={tx('পেশা')}>
                <Select allowClear options={toOptions(meta?.occupations)} />
              </Form.Item>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              {isEdit && (
                <Form.Item name="is_active" valuePropName="checked">
                  <Checkbox>{tx('সক্রিয়')}</Checkbox>
                </Form.Item>
              )}
            </Card>
          </Col>
        </Row>

        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>
            {tx('সংরক্ষণ')}
          </Button>
          <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
        </Space>
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
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={tx('এই তথ্যের সাথে মিলে যায় এমন কৃষক আগে থেকেই আছেন। একই ব্যক্তি হলে নতুন রেকর্ড না করে আগেরটি খুলুন।')}
        />
        <DuplicateMatches matches={duplicates ?? []} />
      </Modal>
    </>
  )
}
