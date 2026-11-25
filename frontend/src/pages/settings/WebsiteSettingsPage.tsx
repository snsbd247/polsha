import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { App, Button, Col, DatePicker, Form, Input, Row, Spin, Switch, Upload, type FormInstance } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FilePdfOutlined,
  MailOutlined,
  GlobalOutlined,
  NotificationOutlined,
  PictureOutlined,
  QuestionCircleOutlined,
  ShareAltOutlined,
  StarOutlined,
  PlusOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { t as tx } from '../../lib/i18n'
import { appPath } from '../../lib/phase8'
import FundMemberPicker from '../../components/FundMemberPicker'
import { emptyBi, sitePhotoUrl, type Bi, type SiteContent, type SiteNotice, type SitePerson } from '../../lib/website'
import SettingsShell, { SettingsCard } from './SettingsShell'
import './website-settings.css'

type FormNotice = Omit<SiteNotice, 'date'> & { date: Dayjs }
type FormValues = Omit<SiteContent, 'notices'> & { notices: FormNotice[] }

/** Bangla + English inputs side by side for one text of the website. */
function BiInput({ name, label, max, area, rows = 4, required, extra }: { name: (string | number)[]; label: string; max: number; area?: boolean; rows?: number; required?: boolean; extra?: ReactNode }) {
  const Field = area ? Input.TextArea : Input
  const props = area ? { rows, maxLength: max, showCount: true } : { maxLength: max }
  return (
    <Row gutter={12}>
      <Col xs={24} md={12}>
        <Form.Item name={[...name, 'bn']} label={`${label} (${tx('বাংলা')})`} rules={required ? [{ required: true, message: tx('লেখা দিন') }] : []} extra={extra}>
          <Field {...props} />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item name={[...name, 'en']} label={`${label} (English)`} extra={tx('ঐচ্ছিক — খালি থাকলে English-এও বাংলা দেখাবে')}>
          <Field {...props} />
        </Form.Item>
      </Col>
    </Row>
  )
}

/** A date kept as "YYYY-MM-DD" in the form, shown in a date picker. */
const dateField = {
  getValueProps: (v?: string | null) => ({ value: v ? dayjs(v) : null }),
  normalize: (d?: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null),
}

/** The extra details on a committee member's own page of the website. */
function CommitteeProfile({ form, index }: { form: FormInstance; index: number }) {
  const { message } = App.useApp()
  const path = (k: string) => ['committee', index, k]
  const pickMember = async (id: number | null) => {
    form.setFieldValue(path('member_id'), id)
    if (!id) return
    try {
      const r = (await api.get<Required<Pick<SitePerson, 'name' | 'village' | 'occupation' | 'education' | 'phone' | 'email'>> & { photo: string | null }>(`/settings/website/member-profile/${id}`)).data
      // only the empty boxes are filled: what was typed stays
      const fill = (k: 'name' | 'village' | 'occupation' | 'education') => {
        const cur = (form.getFieldValue(path(k)) ?? {}) as Partial<Bi>
        form.setFieldValue(path(k), { bn: cur.bn?.trim() || r[k].bn, en: cur.en?.trim() || r[k].en })
      }
      ;(['name', 'village', 'occupation', 'education'] as const).forEach(fill)
      for (const k of ['phone', 'email', 'photo'] as const) {
        if (!form.getFieldValue(path(k)) && r[k]) form.setFieldValue(path(k), r[k])
      }
      message.success(tx('সদস্যের রেকর্ড থেকে খালি ঘরগুলো পূরণ হয়েছে।'))
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <div className="ws-profile">
      <Form.Item name={[index, 'member_id']} label={tx('সমিতির সদস্য হলে বেছে নিন')} extra={tx('নাম, ছবি, গ্রাম, পেশা, শিক্ষা ও মোবাইল সদস্যের রেকর্ড থেকে নেওয়া হবে; সদস্য নং প্রোফাইলে দেখাবে।')}>
        <FundMemberPicker kind="share" plain onChange={pickMember} />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name={[index, 'term_from']} label={tx('মেয়াদ শুরু')} {...dateField}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={[index, 'term_to']} label={tx('মেয়াদ শেষ')} {...dateField}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
        </Col>
      </Row>
      <BiInput name={[index, 'village']} label={tx('গ্রাম/ঠিকানা')} max={150} />
      <BiInput name={[index, 'occupation']} label={tx('পেশা')} max={100} />
      <BiInput name={[index, 'education']} label={tx('শিক্ষাগত যোগ্যতা')} max={100} />
      <BiInput name={[index, 'bio']} label={tx('পরিচিতি')} max={3000} area rows={4} />
      <BiInput name={[index, 'message']} label={tx('বাণী/উক্তি')} max={1000} area rows={2} />
      <BiInput name={[index, 'responsibilities']} label={tx('দায়িত্ব ও উপ-কমিটি')} max={500} area rows={2} />
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name={[index, 'phone']} label={tx('মোবাইল')} extra={tx('দিলে ওয়েবসাইটের প্রোফাইলে দেখাবে')}>
            <Input maxLength={30} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={[index, 'email']} label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]} extra={tx('দিলে ওয়েবসাইটের প্রোফাইলে দেখাবে')}>
            <Input maxLength={100} />
          </Form.Item>
        </Col>
      </Row>
    </div>
  )
}

/** A notice's attachment: a PDF or a photo; the path is saved with the page. */
function AttachmentField({ value, onChange, onName, nameOf }: { value?: string | null; onChange?: (v: string | null) => void; onName: (n: string) => void; nameOf: () => string | undefined }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const body = new FormData()
      body.append(pdf ? 'file' : 'image', file)
      const r = await api.post<{ path: string }>(pdf ? '/settings/website/files' : '/settings/website/images', body)
      onChange?.(r.data.path)
      onName(file.name.slice(0, 150))
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
    return false
  }
  const isPdf = value?.endsWith('.pdf')
  return (
    <div className="ws-attach">
      {value && (
        <a href={sitePhotoUrl(value)} target="_blank" rel="noreferrer" className="ws-attach-file">
          {isPdf ? <FilePdfOutlined /> : <PictureOutlined />} {nameOf() || (isPdf ? 'PDF' : tx('ছবি'))}
        </a>
      )}
      <Upload accept="application/pdf,image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={upload}>
        <Button size="small" icon={<UploadOutlined />} loading={busy}>
          {value ? tx('বদলান') : tx('ফাইল দিন')}
        </Button>
      </Upload>
      {value && (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            onChange?.(null)
            onName('')
          }}
        >
          {tx('সরান')}
        </Button>
      )}
    </div>
  )
}

/** One uploaded photo; the path is saved with the page. */
function PhotoField({ value, onChange, round }: { value?: string | null; onChange?: (v: string | null) => void; round?: boolean }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const body = new FormData()
      body.append('image', file)
      const r = await api.post<{ path: string }>('/settings/website/images', body)
      onChange?.(r.data.path)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
    return false
  }
  return (
    <div className="ws-photo">
      <div className={`ws-photo-box${round ? ' ws-round' : ''}`}>{value ? <img src={sitePhotoUrl(value)} alt="" /> : <PictureOutlined />}</div>
      <div className="ws-photo-actions">
        <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={upload}>
          <Button size="small" icon={<UploadOutlined />} loading={busy}>
            {value ? tx('ছবি বদলান') : tx('ছবি দিন')}
          </Button>
        </Upload>
        {value && (
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onChange?.(null)}>
            {tx('সরান')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Up to three photos the top of the page slides through; none → the built-in photos. */
function HeroPhotos({ value = [], onChange }: { value?: string[]; onChange?: (v: string[]) => void }) {
  return (
    <div className="ws-hero-photos">
      {[0, 1, 2].map((i) =>
        i <= value.length ? (
          <PhotoField
            key={i}
            value={value[i] ?? null}
            onChange={(p) => onChange?.(p ? Object.assign([...value], { [i]: p }) : value.filter((_, j) => j !== i))}
          />
        ) : null,
      )}
    </div>
  )
}

export default function WebsiteSettingsPage() {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  // committee rows whose profile details are open
  const [openProfiles, setOpenProfiles] = useState<number[]>([])
  const toggleProfile = (i: number) => setOpenProfiles((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))

  const { data, isLoading } = useQuery({
    queryKey: ['settings-website'],
    queryFn: async () => (await api.get<SiteContent>('/settings/website')).data,
  })
  const { data: general } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, string>>('/settings')).data,
  })

  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, notices: data.notices.map((n) => ({ ...n, date: dayjs(n.date) })) })
  }, [data, form])

  const save = async (v: FormValues) => {
    setSaving(true)
    try {
      const body = { ...v, notices: (v.notices ?? []).map((n) => ({ ...n, date: n.date.format('YYYY-MM-DD') })) }
      const r = await api.put<SiteContent>('/settings/website', body)
      form.setFieldsValue({ ...r.data, notices: r.data.notices.map((n) => ({ ...n, date: dayjs(n.date) })) })
      queryClient.invalidateQueries({ queryKey: ['public-website'] })
      message.success(tx('ওয়েবসাইট সংরক্ষণ হয়েছে।'))
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
      // a mistake inside a closed profile must be visible
      const bad = form.getFieldsError().filter((f) => f.errors.length && f.name[0] === 'committee').map((f) => Number(f.name[1]))
      if (bad.length) setOpenProfiles((o) => Array.from(new Set([...o, ...bad])))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Spin />

  const saveBtn = (
    <Button type="primary" htmlType="submit" loading={saving}>
      {tx('সংরক্ষণ')}
    </Button>
  )

  return (
    <SettingsShell
      title={tx('ওয়েবসাইট')}
      subtitle={tx('লগইন ছাড়া যে ওয়েবসাইট দেখায় — হোম, আমাদের সম্পর্কে, সেবা, নোটিশ, গ্যালারি, প্রশ্নোত্তর ও যোগাযোগ, প্রতিটি আলাদা পাতা।')}
      extra={
        <>
          <Link to="/settings/website-messages">
            <Button icon={<MailOutlined />}>{tx('ওয়েবসাইটের বার্তা')}</Button>
          </Link>
          <Button icon={<ExportOutlined />} href={appPath('/site')} target="_blank">
            {tx('ওয়েবসাইট দেখুন')}
          </Button>
        </>
      }
    >
      <Form form={form} layout="vertical" onFinish={save} className="ws">
        <SettingsCard icon={<GlobalOutlined />} title={tx('সাধারণ')} subtitle={tx('বন্ধ রাখলে মূল ঠিকানায় আগের মতো লগইন পাতা আসবে।')}>
          <Row gutter={24}>
            <Col xs={24} md={8}>
              <Form.Item name="enabled" label={tx('ওয়েবসাইট চালু')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="show_stats" label={tx('সংখ্যার সারি দেখাবে')} valuePropName="checked" extra={tx('কৃষক ও সদস্য, সেচকৃত জমি ও পানির সংযোগ — সিস্টেমের হিসাব থেকে নিজে আসে।')}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </SettingsCard>

        <SettingsCard icon={<StarOutlined />} title={tx('হেডার ও প্রথম অংশ')} subtitle={tx('লোগোর পাশের নাম, বড় শিরোনাম ও পেছনের ছবি।')}>
          <BiInput name={['brand_title']} label={tx('লোগোর পাশের নাম')} max={80} extra={tx('খালি থাকলে সমিতির নাম দেখাবে।')} />
          <BiInput name={['brand_subtitle']} label={tx('নামের নিচের লাইন')} max={120} />
          <BiInput name={['brand_tagline']} label={tx('ছোট স্লোগান')} max={120} />
          <BiInput name={['hero_kicker']} label={tx('শিরোনামের উপরের ছোট লাইন')} max={80} />
          <BiInput name={['hero_title']} label={tx('বড় শিরোনাম')} max={160} area rows={4} extra={tx('প্রতি লাইন আলাদা লাইনে লিখুন; [ ] বন্ধনীর ভেতরের শব্দ সবুজ দেখাবে।')} />
          <BiInput name={['tagline']} label={tx('শিরোনামের নিচের লাইন')} max={200} />
          <Form.Item name="hero_photos" label={tx('পেছনের ছবি (সর্বোচ্চ ৩টি)')} extra={tx('চওড়া ছবি দিন; না দিলে সফটওয়্যারের নিজস্ব ছবি দেখাবে।')}>
            <HeroPhotos />
          </Form.Item>
        </SettingsCard>

        <SettingsCard icon={<TeamOutlined />} title={tx('আমাদের সম্পর্কে')} subtitle={tx('পরিচিতি, লক্ষ্য, উদ্দেশ্য ও মূল্যবোধ।')}>
          <BiInput name={['about_title']} label={tx('শিরোনাম')} max={120} extra={tx('খালি থাকলে সমিতির পূর্ণ নাম দেখাবে।')} />
          <BiInput name={['intro']} label={tx('সমিতির পরিচিতি')} max={1500} area />
          <BiInput name={['vision']} label={tx('আমাদের লক্ষ্য')} max={300} area rows={2} />
          <BiInput name={['mission']} label={tx('আমাদের উদ্দেশ্য')} max={300} area rows={2} />
          <BiInput name={['values']} label={tx('আমাদের মূল্যবোধ')} max={300} area rows={2} />
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="founded_year" label={tx('প্রতিষ্ঠার সাল')} extra={tx('যেমন ১৯৯৮ — "বছরের সেবা" এখান থেকে হিসাব হয়।')}>
                <Input maxLength={4} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item label={tx('নিবন্ধন নং')} extra={tx('সাধারণ সেটিংস থেকে আসে।')}>
                <Input value={general?.registration_no || '—'} disabled />
              </Form.Item>
            </Col>
          </Row>
          <BiInput name={['work_area']} label={tx('কর্ম এলাকা')} max={150} />
          <Form.Item name="about_photo" label={tx('"আমাদের সম্পর্কে" অংশের ছবি')}>
            <PhotoField />
          </Form.Item>
        </SettingsCard>

        <SettingsCard icon={<UserOutlined />} title={tx('সভাপতির বাণী')} subtitle={tx('"আমাদের সম্পর্কে" পাতায় দেখাবে; বাণী খালি থাকলে অংশটি লুকানো থাকে।')}>
          <div className="ws-person">
            <Form.Item name={['president', 'photo']} className="ws-person-photo">
              <PhotoField round />
            </Form.Item>
            <div className="ws-person-fields">
              <BiInput name={['president', 'name']} label={tx('নাম')} max={100} />
              <BiInput name={['president', 'role']} label={tx('পদবি')} max={60} />
            </div>
          </div>
          <BiInput name={['president', 'message']} label={tx('বাণী')} max={3000} area rows={5} />
        </SettingsCard>

        <SettingsCard icon={<NotificationOutlined />} title={tx('নোটিশ বোর্ড')} subtitle={tx('নতুন নোটিশ আগে দেখায়; কোনো নোটিশ না থাকলে অংশটি লুকানো থাকে।')}>
          <Form.List name="notices">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <div className="ws-item" key={f.key}>
                    <Row gutter={12} align="bottom">
                      <Col xs={24} md={6}>
                        <Form.Item name={[f.name, 'date']} label={tx('তারিখ')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name={[f.name, 'tag', 'bn']} label={tx('ট্যাগ (বাংলা)')}>
                          <Input maxLength={40} placeholder={tx('যেমন: সেচ, সভা')} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name={[f.name, 'tag', 'en']} label={tx('ট্যাগ (English)')}>
                          <Input maxLength={40} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={2}>
                        <Form.Item>
                          <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)} aria-label={tx('মুছুন')} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <BiInput name={[f.name, 'title']} label={tx('নোটিশ')} max={250} required />
                    <BiInput name={[f.name, 'body']} label={tx('নোটিশের পুরো লেখা')} max={5000} area rows={4} extra={tx('নোটিশের নিজের পাতায় দেখাবে; খালি রাখা যায়।')} />
                    {/* the notice's page address; kept when edited */}
                    <Form.Item name={[f.name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item name={[f.name, 'attachment_name']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item name={[f.name, 'attachment']} label={tx('সংযুক্তি (PDF বা ছবি, ঐচ্ছিক)')}>
                      <AttachmentField nameOf={() => form.getFieldValue(['notices', f.name, 'attachment_name'])} onName={(n) => form.setFieldValue(['notices', f.name, 'attachment_name'], n)} />
                    </Form.Item>
                  </div>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ date: dayjs(), title: emptyBi(), tag: emptyBi(), body: emptyBi(), attachment: null }, 0)} disabled={fields.length >= 30}>
                  {tx('নোটিশ যোগ করুন')}
                </Button>
              </>
            )}
          </Form.List>
        </SettingsCard>

        <SettingsCard icon={<QuestionCircleOutlined />} title={tx('সচরাচর জিজ্ঞাসা')} subtitle={tx('প্রথম ৮টি প্রশ্ন দেখায়, বাকিগুলো "সব দেখুন"-এ।')}>
          <Form.List name="faqs">
            {(fields, { add, remove, move }) => (
              <>
                {fields.map((f, i) => (
                  <div className="ws-item ws-faq" key={f.key}>
                    <div className="ws-person-fields">
                      <BiInput name={[f.name, 'q']} label={tx('প্রশ্ন')} max={200} required />
                      <BiInput name={[f.name, 'a']} label={tx('উত্তর')} max={1000} area rows={2} required />
                    </div>
                    <div className="ws-person-tools">
                      <Button type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={tx('উপরে')} />
                      <Button type="text" icon={<ArrowDownOutlined />} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)} aria-label={tx('নিচে')} />
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} aria-label={tx('মুছুন')} />
                    </div>
                  </div>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ q: emptyBi(), a: emptyBi() })} disabled={fields.length >= 20}>
                  {tx('প্রশ্ন যোগ করুন')}
                </Button>
              </>
            )}
          </Form.List>
        </SettingsCard>

        <SettingsCard
          icon={<TeamOutlined />}
          title={tx('পরিচালনা কমিটি')}
          subtitle={tx('যে ক্রমে সাজাবেন সেই ক্রমে দেখাবে; ছবি না দিলে নামের আদ্যক্ষর দেখাবে। প্রত্যেকের আলাদা প্রোফাইল পাতা থাকে — "প্রোফাইল" চেপে বিস্তারিত দিন।')}
        >
          <Form.List name="committee">
            {(fields, { add, remove, move }) => (
              <>
                {fields.map((f, i) => {
                  const open = openProfiles.includes(i)
                  const id = form.getFieldValue(['committee', f.name, 'id']) as string | undefined
                  return (
                    <div className="ws-item" key={f.key}>
                      <div className="ws-person">
                        <Form.Item name={[f.name, 'photo']} className="ws-person-photo">
                          <PhotoField round />
                        </Form.Item>
                        <div className="ws-person-fields">
                          <BiInput name={[f.name, 'name']} label={tx('নাম')} max={100} required />
                          <BiInput name={[f.name, 'role']} label={tx('পদবি')} max={60} required />
                          <div className="ws-profile-bar">
                            <Button icon={<DownOutlined rotate={open ? 180 : 0} />} onClick={() => toggleProfile(i)} aria-expanded={open}>
                              {open ? tx('প্রোফাইল বন্ধ করুন') : tx('প্রোফাইল')}
                            </Button>
                            {id && (
                              <Button type="link" icon={<ExportOutlined />} href={appPath(`/committee/${id}`)} target="_blank">
                                {tx('প্রোফাইল পাতা দেখুন')}
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="ws-person-tools">
                          <Button type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => (move(i, i - 1), setOpenProfiles([]))} aria-label={tx('উপরে')} />
                          <Button type="text" icon={<ArrowDownOutlined />} disabled={i === fields.length - 1} onClick={() => (move(i, i + 1), setOpenProfiles([]))} aria-label={tx('নিচে')} />
                          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => (remove(f.name), setOpenProfiles([]))} aria-label={tx('মুছুন')} />
                        </div>
                      </div>
                      {/* kept mounted while closed so its values are saved with the page */}
                      <div hidden={!open}>
                        <CommitteeProfile form={form} index={f.name} />
                      </div>
                    </div>
                  )
                })}
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => (add({ name: emptyBi(), role: emptyBi(), photo: null }), setOpenProfiles((o) => [...o, fields.length]))}
                  disabled={fields.length >= 20}
                >
                  {tx('সদস্য যোগ করুন')}
                </Button>
              </>
            )}
          </Form.List>
        </SettingsCard>

        <SettingsCard icon={<PictureOutlined />} title={tx('গ্যালারি')} subtitle={tx('সর্বোচ্চ ১২টি ছবি; ছবি না থাকলে অংশটি লুকানো থাকে।')}>
          <Form.List name="gallery">
            {(fields, { add, remove }) => (
              <>
                <div className="ws-gallery">
                  {fields.map((f) => (
                    <div className="ws-item ws-gallery-item" key={f.key}>
                      <Form.Item name={[f.name, 'photo']} rules={[{ required: true, message: tx('ছবি দিন') }]}>
                        <PhotoField />
                      </Form.Item>
                      <Form.Item name={[f.name, 'caption', 'bn']} label={tx('ক্যাপশন (বাংলা)')}>
                        <Input maxLength={120} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'caption', 'en']} label={tx('ক্যাপশন (English)')}>
                        <Input maxLength={120} />
                      </Form.Item>
                      <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)}>
                        {tx('মুছুন')}
                      </Button>
                    </div>
                  ))}
                </div>
                <Button icon={<PlusOutlined />} onClick={() => add({ photo: null, caption: emptyBi() })} disabled={fields.length >= 12}>
                  {tx('ছবি যোগ করুন')}
                </Button>
              </>
            )}
          </Form.List>
        </SettingsCard>

        <SettingsCard icon={<EnvironmentOutlined />} title={tx('যোগাযোগ')} subtitle={tx('ফোন, ইমেইল ও ঠিকানা খালি রাখলে সাধারণ সেটিংসের তথ্য দেখাবে।')}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label={tx('ফোন')}>
                <Input maxLength={30} placeholder={general?.phone || ''} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label={tx('ইমেইল')} rules={[{ type: 'email', message: tx('সঠিক ইমেইল দিন') }]}>
                <Input maxLength={100} placeholder={general?.email || ''} />
              </Form.Item>
            </Col>
          </Row>
          <BiInput name={['address']} label={tx('ঠিকানা')} max={250} />
          <BiInput name={['hours']} label={tx('অফিসের সময়')} max={100} />
          <Form.Item
            name="map_url"
            label={tx('গুগল ম্যাপের লিংক')}
            extra={tx('Google Maps-এ সমিতির জায়গা খুলে Share → Embed a map → লিংকের src অংশটি (https://www.google.com/maps/embed?...) এখানে দিন।')}
          >
            <Input maxLength={1000} placeholder="https://www.google.com/maps/embed?pb=..." />
          </Form.Item>
        </SettingsCard>

        <SettingsCard icon={<ShareAltOutlined />} title={tx('সোশ্যাল মিডিয়া')} subtitle={tx('লিংক দিলে উপরের সারি ও ফুটারে আইকন দেখাবে।')}>
          <Row gutter={12}>
            {(['facebook', 'youtube', 'instagram'] as const).map((k) => (
              <Col xs={24} md={8} key={k}>
                <Form.Item name={k} label={k === 'facebook' ? 'Facebook' : k === 'youtube' ? 'YouTube' : 'Instagram'} rules={[{ type: 'url', message: tx('সঠিক লিংক দিন') }]}>
                  <Input maxLength={300} placeholder={`https://www.${k}.com/...`} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </SettingsCard>

        <div className="ws-save">{saveBtn}</div>
      </Form>
    </SettingsShell>
  )
}
