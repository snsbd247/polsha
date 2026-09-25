import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Col, ColorPicker, Form, Input, Popconfirm, Row, Space, Spin, Typography, Upload } from 'antd'
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { DEFAULT_BRAND, logoUrl, settingImagePath } from '../../lib/settings'
import { t as tx } from '../../lib/i18n'
import SettingsShell from './SettingsShell'

type Slot = 'logo' | 'signature' | 'seal'
type Settings = Record<string, unknown> & { logo: string | null; signature_set?: boolean; seal_set?: boolean }

/** Preview of an uploaded image; signature and seal sit behind sign-in so they come as blobs. */
const PREVIEW = { height: 72, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 12 } as const

function SlotPreview({ slot, version }: { slot: Slot; version: string }) {
  if (slot === 'logo') return <img src={`${logoUrl()}?v=${encodeURIComponent(version)}`} alt="" style={PREVIEW} />
  return <ProtectedSlot slot={slot} version={version} />
}

function ProtectedSlot({ slot, version }: { slot: 'signature' | 'seal'; version: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    api
      .get(settingImagePath(slot), { baseURL: '', responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        url = URL.createObjectURL(r.data)
        setSrc(url)
      })
      .catch(() => setSrc(undefined))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [slot, version])
  return src ? <img src={src} alt="" style={PREVIEW} /> : null
}

export default function BrandingSettingsPage() {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Settings>('/settings')).data,
  })

  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, brand_color: data.brand_color || DEFAULT_BRAND })
  }, [data, form])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['public-settings'] })
    refetch()
  }

  const save = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      const color = v.brand_color
      const hex = typeof color === 'string' ? color : (color as { toHexString: () => string }).toHexString()
      await api.put('/settings/branding', { ...v, brand_color: hex })
      message.success(tx('সেটিংস সংরক্ষণ হয়েছে।'))
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (slot: Slot, file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    try {
      await api.post(`/settings/images/${slot}`, fd)
      message.success(tx('ছবি আপলোড হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
    return false
  }

  const remove = async (slot: Slot) => {
    try {
      await api.delete(`/settings/images/${slot}`)
      message.success(tx('ছবি সরানো হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (isLoading || !data) return <Spin />

  const slots: { slot: Slot; title: string; help: string; set: boolean; version: string }[] = [
    { slot: 'logo', title: tx('লোগো'), help: tx('রশিদ, রিপোর্ট ও লগইন পাতার উপরে দেখাবে।'), set: !!data.logo, version: String(data.logo ?? '') },
    { slot: 'signature', title: tx('অনুমোদিত স্বাক্ষর'), help: tx('রশিদে আদায়কারীর স্বাক্ষরের ঘরে ছাপা হবে। স্বচ্ছ ব্যাকগ্রাউন্ডের PNG ভালো।'), set: !!data.signature_set, version: String(data.signature ?? data.signature_set) },
    { slot: 'seal', title: tx('সিল'), help: tx('রশিদের নিচের কোণে হালকা করে ছাপা হবে।'), set: !!data.seal_set, version: String(data.seal ?? data.seal_set) },
  ]

  return (
    <SettingsShell title={tx('ব্র্যান্ডিং ও লোগো')} subtitle={tx('রং, প্যাডের লেখা, লোগো, স্বাক্ষর ও সিল — সব ছাপা কাগজে ব্যবহার হয়।')}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Form form={form} layout="vertical" onFinish={save}>
            <Card title={tx('রং ও লেখা')}>
              <Form.Item name="brand_color" label={tx('প্রধান রং')} extra={tx('মেন্যু, বোতাম ও রশিদের শিরোনামে এই রং ব্যবহার হবে।')}>
                <ColorPicker showText disabledAlpha presets={[{ label: tx('প্রস্তাবিত'), colors: [DEFAULT_BRAND, '#1d4ed8', '#7c3aed', '#b91c1c', '#c2410c', '#0f766e'] }]} />
              </Form.Item>
              <Form.Item name="letterhead_text" label={tx('প্যাডের অতিরিক্ত লাইন')} extra={tx('সমিতির নামের নিচে ছাপা হবে, যেমন “স্থাপিত ১৯৯০”।')}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="document_footer" label={tx('সব কাগজের পাদটীকা')} extra={tx('রশিদ ও রিপোর্টের একদম নিচে ছাপা হবে।')}>
                <Input.TextArea rows={2} maxLength={300} />
              </Form.Item>
              <Form.Item name="member_card_note" label={tx('সদস্য কার্ডের নোট')} extra={tx('সদস্য কার্ডের পেছনে/নিচে ছাপা হবে।')}>
                <Input.TextArea rows={2} maxLength={300} />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>
                {tx('সংরক্ষণ')}
              </Button>
            </Card>
          </Form>
        </Col>
        <Col xs={24} lg={12}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {slots.map((s) => (
              <Card key={s.slot} title={s.title}>
                {s.set && <SlotPreview slot={s.slot} version={s.version} />}
                <Typography.Paragraph type="secondary">{s.help}</Typography.Paragraph>
                <Space wrap>
                  <Upload accept="image/png,image/jpeg" showUploadList={false} beforeUpload={(f) => upload(s.slot, f)}>
                    <Button icon={<UploadOutlined />}>{s.set ? tx('বদলান (PNG/JPG, সর্বোচ্চ ৫০০KB)') : tx('আপলোড (PNG/JPG, সর্বোচ্চ ৫০০KB)')}</Button>
                  </Upload>
                  {s.set && (
                    <Popconfirm title={tx('ছবিটি সরাবেন?')} onConfirm={() => remove(s.slot)}>
                      <Button danger icon={<DeleteOutlined />}>
                        {tx('সরান')}
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              </Card>
            ))}
          </Space>
        </Col>
      </Row>
    </SettingsShell>
  )
}
