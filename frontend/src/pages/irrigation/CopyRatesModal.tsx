import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, DatePicker, InputNumber, Modal, Select, Table, Tag } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'

type Row = { irrigation_type_id: number; land_type_id: number | null; irrigation_type: string; land_type: string | null; rate: number; exists: boolean }
type Preview = { from: { id: number; name_bn: string } | null; to: { id: number; name_bn: string; start_date: string }; rows: Row[] }
const keyOf = (r: Pick<Row, 'irrigation_type_id' | 'land_type_id'>) => `${r.irrigation_type_id}-${r.land_type_id ?? 0}`

/**
 * A new season takes the previous season's rates in one step: every source
 * and land type with its old rate, any of which can be changed here. They all
 * go for approval together and go live together.
 */
export default function CopyRatesModal({ open, seasons, onClose }: { open: boolean; seasons: { id: number; name_bn: string }[]; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [to, setTo] = useState<number | undefined>()
  const [from, setFrom] = useState<number | undefined>()
  const [rates, setRates] = useState<Record<string, number | null>>({})
  const [date, setDate] = useState<Dayjs | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setTo(seasons[0]?.id)
      setFrom(undefined)
    }
  }, [open, seasons])

  const preview = useQuery({
    queryKey: ['rate-copy-preview', to, from],
    queryFn: async () => (await api.get<Preview>('/irrigation-rates/copy-preview', { params: { to, from } })).data,
    enabled: open && !!to,
  })
  const p = preview.data
  useEffect(() => {
    if (!p) return
    setRates(Object.fromEntries(p.rows.map((r) => [keyOf(r), r.rate])))
    setDate(dayjs(p.to.start_date))
    if (p.from && !from) setFrom(p.from.id)
  }, [p, from])

  const rows = (p?.rows ?? []).filter((r) => !r.exists)
  const save = async () => {
    if (!p?.from || !to || !date) return
    setSaving(true)
    try {
      const res = await api.post<{ message: string }>('/irrigation-rates/copy', {
        from_season_id: p.from.id,
        to_season_id: to,
        effective_from: date.format('YYYY-MM-DD'),
        rows: rows.filter((r) => (rates[keyOf(r)] ?? 0) > 0).map((r) => ({ irrigation_type_id: r.irrigation_type_id, land_type_id: r.land_type_id, rate: rates[keyOf(r)] })),
      })
      message.success(res.data.message)
      queryClient.invalidateQueries({ queryKey: ['irrigation-rates'] })
      queryClient.invalidateQueries({ queryKey: ['rate-copy-preview'] })
      onClose()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      width={720}
      title={tx('আগের মৌসুমের রেট কপি করুন')}
      onCancel={onClose}
      onOk={save}
      okText={tx('{{p0}}টি রেট অনুমোদনে পাঠান', { p0: digits(rows.length) })}
      okButtonProps={{ loading: saving, disabled: !rows.length || !p?.from }}
      cancelText={tx('ফিরে যান')}
    >
      <div className="iv-grid iv-grid-3" style={{ marginBottom: 12 }}>
        <label className="cr-field">
          {tx('নতুন মৌসুম')}
          <Select value={to} options={seasons.map((s) => ({ value: s.id, label: s.name_bn }))} onChange={(v) => (setTo(v), setFrom(undefined))} />
        </label>
        <label className="cr-field">
          {tx('যে মৌসুম থেকে কপি')}
          <Select value={from} placeholder={tx('আগের মৌসুম')} options={seasons.filter((s) => s.id !== to).map((s) => ({ value: s.id, label: s.name_bn }))} onChange={setFrom} />
        </label>
        <label className="cr-field">
          {tx('কার্যকর তারিখ')}
          <DatePicker value={date} format="DD/MM/YYYY" allowClear={false} onChange={setDate} style={{ width: '100%' }} />
        </label>
      </div>
      {p && !p.from && <Alert type="warning" showIcon title={tx('কপি করার মতো আগের কোনো মৌসুমে অনুমোদিত রেট নেই।')} />}
      {p?.from && (
        <>
          {rows.length ? (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('রেট দরকার হলে বদলান। সব রেট একসাথে একবার অনুমোদনে যাবে, অনুমোদনের পর একসাথে চালু হবে।')} />
          ) : (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={tx('এই মৌসুমে এই রেটগুলো আগে থেকেই আছে — উপরে অন্য (নতুন) মৌসুম বাছুন।')} />
          )}
          <Table<Row>
            rowKey={keyOf}
            size="small"
            loading={preview.isFetching}
            dataSource={p.rows}
            pagination={false}
            scroll={{ x: 'max-content', y: 320 }}
            columns={[
              { title: tx('সেচের উৎস'), dataIndex: 'irrigation_type' },
              { title: tx('জমির ধরন'), dataIndex: 'land_type', render: (v: string | null) => v ?? tx('সব ধরনের জমি') },
              { title: tx('আগের রেট (প্রতি শতক)'), dataIndex: 'rate', align: 'right', render: (v: number) => `৳ ${money(v)}` },
              {
                title: tx('নতুন রেট'),
                width: 150,
                render: (_, r) =>
                  r.exists ? (
                    <Tag className="fl-tag ll-gray">{tx('আগে থেকেই আছে')}</Tag>
                  ) : (
                    <InputNumber min={0.01} precision={2} prefix="৳" value={rates[keyOf(r)]} onChange={(v) => setRates((x) => ({ ...x, [keyOf(r)]: v }))} style={{ width: 130 }} />
                  ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  )
}
