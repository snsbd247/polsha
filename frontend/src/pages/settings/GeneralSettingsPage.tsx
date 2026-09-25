import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Col, DatePicker, Form, Input, Popconfirm, Row, Select, Spin, Upload } from 'antd'
import { BankFilled, CompassFilled, DeleteOutlined, EnvironmentFilled, InfoCircleFilled, PhoneFilled, PictureFilled, SaveFilled, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { LevelSelect, LEVELS, type LocationPath } from '../../components/LocationCascader'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { DATE_FORMATS } from '../../lib/format'
import { logoUrl } from '../../lib/settings'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import SettingsShell, { SettingsCard } from './SettingsShell'

type Settings = Record<string, unknown> & { logo: string | null; logo_url: string | null; default_location?: number[]; default_mouza_id?: number | null }

const SOCIETY_TYPES = [
  { value: 'agricultural', label: tx('কৃষি সমবায় সমিতি') },
  { value: 'irrigation', label: tx('সেচ সমবায় সমিতি') },
  { value: 'multipurpose', label: tx('বহুমুখী সমবায় সমিতি') },
  { value: 'savings_credit', label: tx('সঞ্চয় ও ঋণদান সমবায় সমিতি') },
  { value: 'other', label: tx('অন্যান্য') },
]

/** Division … village selects in a two-column grid, plus the default mouza of that village. */
function LocationFields({ path, onChange, mouzaId, onMouza }: { path: LocationPath; onChange: (p: LocationPath) => void; mouzaId?: number | null; onMouza: (id?: number) => void }) {
  const village = path[4]
  const mouzas = useQuery({
    queryKey: ['mouzas', 'by-village', village],
    queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1, village_id: village } })).data,
    enabled: !!village,
  })
  const set = (i: number, v?: number) => {
    onChange([...path.slice(0, i), v, ...Array(4 - i).fill(undefined)].slice(0, 5))
    onMouza(undefined)
  }
  return (
    <div className="st-grid2">
      {LEVELS.map((level, i) => (
        <div key={level.key} className="st-field">
          <span>{level.label}</span>
          <LevelSelect index={i} parentId={i === 0 ? undefined : path[i - 1]} value={path[i]} onChange={(v) => set(i, v)} placeholder={tx('বাছাই করুন')} />
        </div>
      ))}
      <div className="st-field">
        <span>{tx('মৌজা (ডিফল্ট)')}</span>
        <Select
          allowClear
          disabled={!village}
          value={mouzas.data ? (mouzaId ?? undefined) : undefined}
          placeholder={village ? tx('বাছাই করুন') : tx('আগে গ্রাম বাছাই করুন')}
          loading={mouzas.isFetching}
          onChange={(v) => onMouza(v)}
          options={mouzas.data?.map((m) => ({ value: m.id, label: nameOf(m) }))}
        />
      </div>
    </div>
  )
}

export default function GeneralSettingsPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [path, setPath] = useState<LocationPath>([])
  const [mouzaId, setMouzaId] = useState<number | null | undefined>()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Settings>('/settings')).data,
  })

  const load = (d: Settings) => {
    form.resetFields()
    form.setFieldsValue({ ...d, registration_date: d.registration_date ? dayjs(String(d.registration_date)) : null })
    setPath(d.default_location ?? [])
    setMouzaId(d.default_mouza_id)
  }
  useEffect(() => {
    if (data) load(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['public-settings'] })
    refetch()
  }

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.put('/settings', {
        ...v,
        registration_date: v.registration_date ? (v.registration_date as dayjs.Dayjs).format('YYYY-MM-DD') : null,
        default_location: path.filter((p) => p !== undefined),
        default_mouza_id: mouzaId ?? null,
      })
      message.success(tx('সেটিংস সংরক্ষণ হয়েছে।'))
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const uploadLogo = async (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    try {
      await api.post('/settings/images/logo', fd)
      message.success(tx('লোগো আপলোড হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
    return false
  }

  const removeLogo = async () => {
    try {
      await api.delete('/settings/images/logo')
      message.success(tx('ছবি সরানো হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (isLoading || !data) return <Spin />
  const logo = data.logo ? `${logoUrl()}?v=${encodeURIComponent(String(data.logo))}` : null
  const nameBn = String(data.society_name_bn ?? '')
  const nameEn = String(data.society_name_en ?? '')
  const primary = nameOf({ name_bn: nameBn, name_en: nameEn })
  const secondary = primary === nameBn ? nameEn : nameBn

  return (
    <SettingsShell title={tx('সাধারণ সেটিংস')} subtitle={tx('সমিতির তথ্য, যোগাযোগ, অর্থবছর ও সিস্টেমের পছন্দসমূহ পরিচালনা করুন।')}>
      <Form form={form} layout="vertical" onFinish={save} requiredMark={(label, { required: r }) => (r ? <>{label} <span className="st-req">*</span></> : label)}>
        <div className="st-row-top">
          <SettingsCard icon={<BankFilled />} title={tx('সমিতির তথ্যাবলি')} subtitle={tx('সমবায় সমিতির মৌলিক তথ্য।')}>
            <Row gutter={18}>
              <Col xs={24} md={12}>
                <Form.Item name="society_name_bn" label={tx('সমিতির নাম (বাংলা)')} rules={[required(tx('নাম দিন'))]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="society_name_en" label={tx('সমিতির নাম (ইংরেজি)')}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="registration_no" label={tx('নিবন্ধন নম্বর')}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="registration_date" label={tx('প্রতিষ্ঠার তারিখ')}>
                  <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} placeholder={tx('তারিখ বাছাই করুন')} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="society_type" label={tx('সমিতির ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
                  <Select options={SOCIETY_TYPES} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="contact_person" label={tx('যোগাযোগের ব্যক্তি')}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="contact_designation" label={tx('পদবি')}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="contact_email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="contact_mobile" label={tx('মোবাইল নম্বর')}>
                  <Input inputMode="tel" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="contact_mobile_alt" label={tx('বিকল্প মোবাইল')}>
                  <Input inputMode="tel" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="address" label={tx('ঠিকানা')} className="st-last">
                  <Input.TextArea rows={2} maxLength={300} showCount />
                </Form.Item>
              </Col>
            </Row>
          </SettingsCard>

          <div className="st-col">
            <SettingsCard icon={<PictureFilled />} title={tx('সমিতির লোগো')} subtitle={tx('সমিতির লোগো আপলোড করুন। রশিদ, ইনভয়েস ও রিপোর্টে এটি ব্যবহার হবে।')}>
              <Upload.Dragger accept="image/png,image/jpeg" showUploadList={false} beforeUpload={uploadLogo} className="st-drop">
                <div className="st-drop-inner">
                  <span className="st-logo-circle">{logo ? <img src={logo} alt="" /> : <PictureFilled />}</span>
                  <span className="st-drop-text">
                    <strong>{tx('লোগো আপলোড করতে ক্লিক করুন')}</strong>
                    <small>{tx('JPG বা PNG (সর্বোচ্চ ৫০০KB)')}</small>
                    <Button icon={<UploadOutlined />} className="st-outline">
                      {tx('লোগো আপলোড')}
                    </Button>
                  </span>
                </div>
              </Upload.Dragger>
              <div className="st-preview-label">{tx('বর্তমান লোগোর প্রিভিউ')}</div>
              <div className="st-preview">
                <span className="st-logo-sm">{logo ? <img src={logo} alt="" /> : <PictureFilled />}</span>
                <span className="st-preview-names">
                  <strong>{primary}</strong>
                  {secondary && <small>{secondary}</small>}
                </span>
                {data.logo && (
                  <Popconfirm title={tx('ছবিটি সরাবেন?')} onConfirm={removeLogo}>
                    <Button danger size="small" icon={<DeleteOutlined />} className="st-remove">
                      {tx('সরান')}
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </SettingsCard>

            <SettingsCard icon={<EnvironmentFilled />} title={tx('সমিতির ঠিকানা (প্রিন্টের জন্য)')} subtitle={tx('এই ঠিকানা রশিদ, ইনভয়েস ও রিপোর্টে ছাপা হবে।')}>
              <Form.Item name="print_address" className="st-last">
                <Input.TextArea rows={4} maxLength={300} showCount placeholder={tx('খালি রাখলে উপরের ঠিকানা ছাপা হবে।')} />
              </Form.Item>
            </SettingsCard>
          </div>
        </div>

        <div className="st-row-bottom">
          <SettingsCard icon={<CompassFilled />} title={tx('অবস্থানের তথ্য')} subtitle={tx('সমিতির ডিফল্ট এলাকা; নতুন কৃষকের ফর্মে আগে থেকে বসবে।')}>
            <LocationFields path={path} onChange={setPath} mouzaId={mouzaId} onMouza={setMouzaId} />
          </SettingsCard>

          <SettingsCard icon={<PhoneFilled />} title={tx('যোগাযোগ সেটিংস')} subtitle={tx('দাপ্তরিক যোগাযোগের নম্বর ও ইমেইল।')}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="phone" label={tx('দাপ্তরিক ফোন')}>
                  <Input inputMode="tel" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="phone_alt" label={tx('বিকল্প ফোন')}>
                  <Input inputMode="tel" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="website" label={tx('ওয়েবসাইট')} rules={[{ type: 'url', message: tx('সঠিক ওয়েবসাইট দিন (https://...)') }]} className="st-last">
                  <Input placeholder="https://" />
                </Form.Item>
              </Col>
            </Row>
          </SettingsCard>

          <SettingsCard icon={<InfoCircleFilled />} title={tx('অন্যান্য তথ্য')} subtitle={tx('অতিরিক্ত সেটিংস ও তথ্য।')}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="timezone" label={tx('টাইমজোন')}>
                  <Select options={[{ value: 'Asia/Dhaka', label: 'Asia/Dhaka (UTC +06:00)' }]} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="date_format" label={tx('তারিখের ফরম্যাট')}>
                  <Select options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="default_locale" label={tx('ভাষা')}>
                  <Select
                    options={[
                      { value: 'bn', label: 'বাংলা' },
                      { value: 'en', label: 'English' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="currency_symbol" label={tx('মুদ্রা')}>
                  <Select
                    options={[
                      { value: '৳', label: tx('বাংলাদেশি টাকা (৳)') },
                      { value: 'Tk', label: tx('বাংলাদেশি টাকা (Tk)') },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="society_remarks" label={tx('মন্তব্য')} className="st-last">
                  <Input.TextArea rows={2} maxLength={300} showCount />
                </Form.Item>
              </Col>
            </Row>
          </SettingsCard>
        </div>

        <div className="st-footer">
          <Button onClick={() => load(data)}>{tx('বাতিল')}</Button>
          <Button type="primary" htmlType="submit" icon={<SaveFilled />} loading={saving}>
            {tx('সেটিংস সংরক্ষণ')}
          </Button>
        </div>
      </Form>
    </SettingsShell>
  )
}
