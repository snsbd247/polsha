import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Spin, Switch, Table } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import FarmerPicker from '../../components/FarmerPicker'
import OwnersEditor from '../../components/OwnersEditor'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits } from '../../lib/format'
import { fmtArea, useLandMeta, type LandRow } from '../../lib/land'
import { required } from '../../lib/rules'
import type { Mouza } from '../../lib/types'
import { t as tx } from '../../lib/i18n'

type LandDetail = LandRow & { mouza_id: number; land_type_id: number | null; remarks: string | null }
type Match = { id: number; land_code: string; area_decimal: string; owners: { farmer: { name_bn: string } }[] }

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

function LandForm({ id, existing }: { id?: string; existing?: LandDetail }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const { data: meta } = useLandMeta()
  const [withCultivation, setWithCultivation] = useState(false)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [saving, setSaving] = useState(false)

  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const initialValues = useMemo(
    () =>
      existing
        ? { ...existing, area: existing.area_decimal, area_unit: 'decimal' }
        : { survey: 'RS', area_unit: 'decimal', status: 'cultivated', owned_since: dayjs(), owners: [{ share_percent: 100 }], cultivation: { type: 'own', start_date: dayjs() } },
    [existing],
  )

  const area: number | undefined = Form.useWatch('area', form)
  const unit: string | undefined = Form.useWatch('area_unit', form)
  const decimals = area && unit && meta ? area * meta.unit_factors[unit] : 0

  const save = async (confirm = false) => {
    const v = await form.validateFields()
    const payload: Record<string, unknown> = { ...v, irrigation_type_id: v.irrigation_type_id ?? null, confirm_duplicate: confirm }
    if (!isEdit) {
      payload.owned_since = (v.owned_since as Dayjs).format('YYYY-MM-DD')
      payload.cultivation = withCultivation ? { ...v.cultivation, start_date: (v.cultivation.start_date as Dayjs).format('YYYY-MM-DD') } : null
    }
    setSaving(true)
    try {
      const r = isEdit ? await api.put(`/lands/${id}`, payload) : await api.post('/lands', payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['lands'] })
      setMatches(null)
      navigate(`/lands/${r.data.id}`)
    } catch (e) {
      const err = e as AxiosError<{ code?: string; matches?: Match[] }>
      if (err.response?.status === 409 && err.response.data?.code === 'possible_duplicate') setMatches(err.response.data.matches ?? [])
      else if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{isEdit ? tx('জমি সম্পাদনা — {{p0}}', { p0: existing?.land_code }) : tx('নতুন জমি')}</h2>
      </div>
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={() => save(false)}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title={tx('জমির তথ্য')}>
              <Form.Item name="mouza_id" label={tx('মৌজা')} rules={[required(tx('মৌজা বাছাই করুন'))]}>
                <Select showSearch={{ optionFilterProp: 'label' }} options={mouzas.data?.map((m) => ({ value: m.id, label: `${m.name_bn} (JL ${m.jl_no})` }))} />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="survey" label={tx('জরিপ')} rules={[required(tx('জরিপ দিন'))]}>
                    <Select options={Object.entries(meta?.surveys ?? {}).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item name="khatian_no" label={tx('খতিয়ান নং')} rules={[required(tx('খতিয়ান দিন'))]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item name="dag_no" label={tx('দাগ নং')} rules={[required(tx('দাগ দিন'))]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={tx('জমির পরিমাণ')} required extra={decimals > 0 ? `= ${fmtArea(decimals, meta)}` : undefined}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="area" noStyle rules={[required(tx('পরিমাণ দিন'))]}>
                    <InputNumber min={0.0001} style={{ width: '60%' }} />
                  </Form.Item>
                  <Form.Item name="area_unit" noStyle>
                    <Select style={{ width: '40%' }} options={Object.entries(meta?.units ?? {}).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="land_type_id" label={tx('জমির ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
                    <Select options={meta?.land_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="irrigation_type_id" label={tx('সেচের ধরন')} extra={tx('সেচের রেট এই ধরন অনুযায়ী ঠিক হয়')}>
                    <Select allowClear options={meta?.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="status" label={tx('অবস্থা')}>
                    <Select options={Object.entries(meta?.statuses ?? {}).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="remarks" label={tx('মন্তব্য')}>
                <Input.TextArea rows={2} />
              </Form.Item>
            </Card>
          </Col>

          {!isEdit && (
            <Col xs={24} xl={12}>
              <Card title={tx('মালিকানা')}>
                <OwnersEditor />
                <Form.Item name="owned_since" label={tx('মালিকানার শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]} style={{ marginTop: 16 }}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                </Form.Item>
              </Card>
              <Card
                title={tx('চাষি')}
                style={{ marginTop: 16 }}
                extra={<Switch checked={withCultivation} onChange={setWithCultivation} checkedChildren={tx('এখন দিন')} unCheckedChildren={tx('পরে')} />}
              >
                {withCultivation ? (
                  <>
                    <Form.Item name={['cultivation', 'type']} label={tx('চাষের ধরন')}>
                      <Radio.Group options={Object.entries(meta?.cultivation_types ?? {}).map(([value, label]) => ({ value, label }))} />
                    </Form.Item>
                    <Form.Item name={['cultivation', 'farmer_id']} label={tx('চাষি')} rules={[required(tx('চাষি বাছাই করুন'))]} extra={tx('নিজ চাষ হলে চাষিকে মালিকদের একজন হতে হবে; বর্গায় মালিক চাষি হতে পারবেন না।')}>
                      <FarmerPicker />
                    </Form.Item>
                    <Form.Item name={['cultivation', 'terms']} label={tx('শর্ত (বর্গা/লিজ)')}>
                      <Input placeholder={tx('যেমন: ফসলের অর্ধেক, বছরে ৳১০,০০০')} />
                    </Form.Item>
                    <Form.Item name={['cultivation', 'start_date']} label={tx('চাষ শুরুর তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                      <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs())} />
                    </Form.Item>
                  </>
                ) : (
                  <Alert type="info" showIcon title={tx('চাষির তথ্য পরে জমির পাতা থেকেও দেওয়া যাবে।')} />
                )}
              </Card>
            </Col>
          )}
        </Row>
        {isEdit && <Alert type="info" showIcon style={{ marginTop: 16 }} title={tx('মালিকানা ও চাষি বদলাতে জমির পাতার \'মালিকানা হস্তান্তর\' ও \'চাষি পরিবর্তন\' ব্যবহার করুন — এতে ইতিহাস সংরক্ষিত থাকে।')} />}
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>
            {tx('সংরক্ষণ')}
          </Button>
          <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
        </Space>
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
    </>
  )
}
