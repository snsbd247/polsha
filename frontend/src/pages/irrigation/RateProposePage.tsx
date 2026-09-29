import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Spin, Table } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, ClockCircleFilled, CloseOutlined, FileTextFilled, SendOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { useInvoiceMeta, type RatePage, type RateRow } from '../../lib/irrigation'
import { useLandMeta } from '../../lib/land'
import { t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import '../lands/land-form.css'
import './invoices.css'
import './bulk-invoice.css'
import './rates.css'

const REASONS = ['জ্বালানি/বিদ্যুৎ খরচ বৃদ্ধি', 'রক্ষণাবেক্ষণ খরচ', 'কমিটির সিদ্ধান্ত', 'নতুন মৌসুমের রেট', 'ভুল সংশোধন', 'অন্যান্য']
const num = (v: string | null) => (v ? Number(v) : undefined)

/** Propose a new rate for a season, source and land type; it bills only once approved. */
export default function RateProposePage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [sp] = useSearchParams()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { data: meta } = useInvoiceMeta()
  const { data: landMeta } = useLandMeta()
  const detail: string | undefined = Form.useWatch('detail', form)

  const seasonId: number | undefined = Form.useWatch('season_id', form)
  const typeId: number | undefined = Form.useWatch('irrigation_type_id', form)
  const landTypeId: number | null | undefined = Form.useWatch('land_type_id', form)
  const rate: number | undefined = Form.useWatch('rate', form)
  const from: Dayjs | undefined = Form.useWatch('effective_from', form)

  // what this source and land type have been charged before, across seasons
  const history = useQuery({
    queryKey: ['irrigation-rates', 'all', 'combo', typeId, landTypeId],
    queryFn: async () => (await api.get<RatePage>('/irrigation-rates/all', { params: { irrigation_type_id: typeId, land_type_id: landTypeId ?? undefined, sort: 'history', per_page: 50 } })).data,
    enabled: !!typeId,
  })
  if (!meta || !landMeta) return <Spin />

  const combo = (history.data?.data ?? []).filter((r) => (r.land_type_id ?? null) === (landTypeId ?? null))
  const current = combo.find((r) => r.season_id === seasonId && r.state === 'active') ?? null
  const pendingHere = combo.find((r) => r.season_id === seasonId && r.state === 'pending')
  const season = meta.seasons.find((x) => x.id === seasonId)
  const typeName = meta.irrigation_types.find((t) => t.id === typeId)?.name_bn
  const landName = landTypeId ? landMeta.land_types.find((t) => t.id === landTypeId)?.name_bn : tx('সব ধরনের জমি')
  const change = current && rate ? rate - current.rate : null

  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api.post('/irrigation-rates', {
        season_id: v.season_id,
        irrigation_type_id: v.irrigation_type_id,
        land_type_id: v.land_type_id ?? null,
        rate: v.rate,
        effective_from: (v.effective_from as Dayjs).format('YYYY-MM-DD'),
        reason: [v.reason_kind, v.detail].filter(Boolean).join(' — '),
      })
      message.success(tx('রেট অনুমোদনের জন্য পাঠানো হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['irrigation-rates'] })
      navigate('/irrigation/rates')
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const recent: RateRow[] = combo.filter((r) => r.status === 'approved').slice(0, 5)

  return (
    <PageFrame
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('সেচের রেটের তালিকা'), to: '/irrigation/rates' }, { label: tx('নতুন রেট প্রস্তাব') }]}
      title={tx('নতুন সেচের রেট প্রস্তাব')}
      subtitle={tx('একটি মৌসুম, সেচের উৎস ও জমির ধরনের জন্য নতুন রেট দিন। প্রস্তাবিত রেট অনুমোদনের জন্য পাঠানো হবে।')}
      actions={
        <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/irrigation/rates')}>
          {tx('রেটের তালিকায় ফিরুন')}
        </Button>
      }
    >
      <div className="bi-top rp-top">
        <Form
          form={form}
          layout="vertical"
          className="iv-form"
          initialValues={{
            season_id: num(sp.get('season_id')) ?? meta.seasons.find((x) => x.status === 'open')?.id,
            irrigation_type_id: num(sp.get('irrigation_type_id')),
            land_type_id: num(sp.get('land_type_id')) ?? null,
            effective_from: dayjs(),
            reason_kind: REASONS[0],
          }}
        >
          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FileTextFilled className="iv-section-icon" />
              <h3>{digits(1)}. {tx('মূল তথ্য')}</h3>
            </header>
            <div className="lf-card-body">
              <div className="iv-grid iv-grid-3">
                <Form.Item name="season_id" label={tx('মৌসুম')} rules={[{ required: true, message: tx('মৌসুম বাছাই করুন') }]}>
                  <Select prefix={<DashIcon name="sprout" size={16} color="#1f9d55" stroke={2.2} />} options={meta.seasons.map((x) => ({ value: x.id, label: x.name_bn, disabled: x.status === 'closed' }))} />
                </Form.Item>
                <Form.Item name="irrigation_type_id" label={tx('সেচের উৎস')} rules={[{ required: true, message: tx('সেচের উৎস বাছাই করুন') }]}>
                  <Select prefix={<DashIcon name="drop" size={16} color="#1769e0" stroke={2.2} />} placeholder={tx('সেচের উৎস বাছাই করুন')} options={meta.irrigation_types.map((t) => ({ value: t.id, label: t.name_bn }))} />
                </Form.Item>
                <Form.Item name="land_type_id" label={tx('জমির ধরন')}>
                  <Select prefix={<DashIcon name="sprout" size={16} color="#1f9d55" stroke={2.2} />} options={[{ value: null, label: tx('সব ধরনের জমি') }, ...landMeta.land_types.map((t) => ({ value: t.id, label: t.name_bn }))]} />
                </Form.Item>
                <Form.Item label={tx('মাপের একক')}>
                  <Input disabled value={tx('প্রতি শতক')} />
                </Form.Item>
                <Form.Item name="rate" label={tx('প্রস্তাবিত রেট (৳)')} rules={[{ required: true, message: tx('রেট দিন') }]}>
                  <InputNumber min={0.01} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label={tx('বর্তমান রেট (৳)')}>
                  <Input disabled value={current ? money(current.rate) : '—'} />
                </Form.Item>
              </div>
              {pendingHere && <Alert type="warning" showIcon title={tx('এই রেটের একটি পরিবর্তন আগেই অনুমোদনের অপেক্ষায় আছে।')} />}
            </div>
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <CalendarOutlined className="iv-section-icon" />
              <h3>{digits(2)}. {tx('কার্যকর সময়কাল')}</h3>
            </header>
            <div className="lf-card-body iv-grid rp-grid2">
              <Form.Item name="effective_from" label={tx('কার্যকর শুরু')} rules={[{ required: true, message: tx('তারিখ দিন') }]}>
                <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label={tx('কার্যকর শেষ')} extra={tx('পরের রেট পরিবর্তন বা মৌসুম শেষ পর্যন্ত')}>
                <Input disabled prefix={<CalendarOutlined />} value={season ? fmtDate(season.end_date) : ''} />
              </Form.Item>
            </div>
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FileTextFilled className="iv-section-icon" />
              <h3>{digits(3)}. {tx('যৌক্তিকতা')}</h3>
            </header>
            <div className="lf-card-body iv-grid rp-grid2">
              <Form.Item name="reason_kind" label={tx('রেট পরিবর্তনের কারণ')} rules={[{ required: true }]}>
                <Select options={REASONS.map((r) => ({ value: tx(r), label: tx(r) }))} />
              </Form.Item>
              <Form.Item name="detail" label={tx('বিস্তারিত যৌক্তিকতা')} rules={[{ required: true, message: tx('যৌক্তিকতা লিখুন') }]} extra={<span className="iv-count">{tx('{{p0}}/৪০০ অক্ষর', { p0: digits(detail?.length ?? 0) })}</span>}>
                <Input.TextArea rows={3} maxLength={400} />
              </Form.Item>
            </div>
          </section>
        </Form>

        <aside>
          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <FileTextFilled className="iv-section-icon" />
              <h3>{tx('রেটের সারাংশ')}</h3>
            </header>
            <dl className="id-kv bi-kv">
              {(
                [
                  [tx('মৌসুম'), season?.name_bn ?? '—'],
                  [tx('সেচের উৎস'), typeName ?? '—'],
                  [tx('জমির ধরন'), landName ?? '—'],
                  [tx('মাপের একক'), tx('প্রতি শতক')],
                  [tx('এখনকার রেট'), current ? `৳ ${money(current.rate)}` : '—'],
                  [tx('প্রস্তাবিত রেট'), rate ? <strong key="r">৳ {money(rate)}</strong> : '—'],
                  [
                    tx('পরিবর্তন'),
                    change !== null && current ? (
                      <span key="c" className={change >= 0 ? 'rt-up' : 'rt-down'}>
                        {change >= 0 ? '+' : '−'} ৳ {money(Math.abs(change))} ({digits(((Math.abs(change) / current.rate) * 100).toFixed(2))}%)
                      </span>
                    ) : (
                      '—'
                    ),
                  ],
                  [tx('কার্যকর সময়কাল'), from ? `${fmtDate(from.format('YYYY-MM-DD'))} – ${season ? fmtDate(season.end_date) : '…'}` : '—'],
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <span>:</span>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="lf-card iv-section">
            <header className="lf-card-head">
              <ClockCircleFilled className="iv-section-icon" />
              <h3>{tx('এই উৎস ও জমির ধরনের সাম্প্রতিক রেট')}</h3>
            </header>
            <Table<RateRow>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={recent}
              loading={history.isFetching}
              locale={{ emptyText: typeId ? tx('আগের কোনো রেট নেই') : tx('সেচের উৎস বাছাই করুন') }}
              columns={[
                { title: tx('মৌসুম'), dataIndex: 'season' },
                { title: tx('রেট'), dataIndex: 'rate', align: 'right', render: money },
                { title: tx('শুরু'), dataIndex: 'effective_from', render: fmtDate },
                { title: tx('শেষ'), dataIndex: 'effective_to', render: (v) => (v ? fmtDate(v) : '—') },
              ]}
            />
          </section>
        </aside>
      </div>

      <div className="iv-actions">
        <Button icon={<CloseOutlined />} onClick={() => navigate(-1)}>
          {tx('বাতিল')}
        </Button>
        <span className="iv-spacer" />
        <Button type="primary" icon={<SendOutlined />} loading={saving} disabled={!!pendingHere} onClick={submit}>
          {tx('অনুমোদনের জন্য পাঠান')}
        </Button>
      </div>
    </PageFrame>
  )
}
