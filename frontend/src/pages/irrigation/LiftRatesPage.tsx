import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, DatePicker, Input, InputNumber, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarOutlined, CloseOutlined, EditFilled, EyeFilled, InfoCircleFilled, SendOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { money } from '../../lib/accounting'
import { fmtDate } from '../../lib/format'
import { useInvoiceMeta, type Lift, type Named } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../settings/land-types.css'
import './rates.css'

type Current = { irrigation_type_id: number; lift_id: number | null; land_type_id: number | null; rate: number | null; effective_from: string | null; next_rate: number | null; next_from: string | null }
type History = { id: number; irrigation_type_id: number; lift_id: number | null; land_type_id: number | null; rate: string | number; status: string; effective_from: string; approval_request_id: number | null }
type SeasonRates = { current: Current[]; history: History[] }
type LiftList = { data: (Lift & { is_active: boolean; lands_count: number; area_decimal: number })[]; without_lift: number }

const key = (typeId: number, liftId: number) => `${typeId}-${liftId}`

/**
 * One season's rates as a grid: a row per irrigation source, a column per
 * lift. Typing rates into the cells and sending them asks for approval of
 * each changed cell at once; a rate bills only once approved.
 */
export default function LiftRatesPage({ tabs }: { tabs?: ReactNode } = {}) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: meta } = useInvoiceMeta()
  const seasons = meta?.seasons ?? []
  const [seasonId, setSeasonId] = useState<number | undefined>()
  const season = seasons.find((s) => s.id === seasonId) ?? seasons.find((s) => s.status === 'open') ?? seasons[0]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, number | null>>({})
  const [from, setFrom] = useState<Dayjs>(dayjs())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const canEdit = can('irrigation.edit') && season?.status !== 'closed'

  const { data: liftList } = useQuery({ queryKey: ['irrigation-lifts'], queryFn: async () => (await api.get<LiftList>('/irrigation-lifts')).data })
  const lifts = useMemo(() => (liftList?.data ?? []).filter((l) => l.is_active), [liftList])
  const { data, isFetching } = useQuery({
    queryKey: ['irrigation-rates', 'season', season?.id],
    queryFn: async () => (await api.get<SeasonRates>('/irrigation-rates', { params: { season_id: season!.id } })).data,
    enabled: !!season,
  })

  // the lift-wide rate of each cell (rates for one land type within a lift stay on the rate list)
  const currentRows = data?.current
  const historyRows = data?.history
  const current = useMemo(() => {
    const m: Record<string, Current> = {}
    for (const c of currentRows ?? []) if (c.lift_id && !c.land_type_id) m[key(c.irrigation_type_id, c.lift_id)] = c
    return m
  }, [currentRows])
  const pending = useMemo(() => {
    const m: Record<string, History> = {}
    for (const h of historyRows ?? []) if (h.status === 'pending' && h.lift_id && !h.land_type_id) m[key(h.irrigation_type_id, h.lift_id)] ??= h
    return m
  }, [historyRows])
  const types: Named[] = meta?.irrigation_types ?? []
  const filled = Object.keys(current).length
  const changed = Object.entries(draft).filter(([k, v]) => v && v > 0 && !pending[k] && v !== current[k]?.rate)

  const startEdit = () => {
    const d: Record<string, number | null> = {}
    for (const t of types) for (const l of lifts) d[key(t.id, l.id)] = current[key(t.id, l.id)]?.rate ?? null
    setDraft(d)
    setFrom(dayjs(season && dayjs(season.start_date).isAfter(dayjs()) ? season.start_date : undefined))
    setReason('')
    setEditing(true)
  }
  const send = async () => {
    if (!season || !changed.length) return
    setSaving(true)
    let ok = 0
    const errors: string[] = []
    for (const [k, rate] of changed) {
      const [typeId, liftId] = k.split('-').map(Number)
      try {
        await api.post('/irrigation-rates', { season_id: season.id, irrigation_type_id: typeId, lift_id: liftId, rate, effective_from: from.format('YYYY-MM-DD'), reason: reason || null })
        ok++
      } catch (e) {
        errors.push(errorMessage(e))
      }
    }
    setSaving(false)
    queryClient.invalidateQueries({ queryKey: ['irrigation-rates'] })
    queryClient.invalidateQueries({ queryKey: ['approvals'] })
    if (ok) message.success(tx('{{p0}}টি রেট অনুমোদনের জন্য পাঠানো হয়েছে।', { p0: n0(ok) }))
    if (errors.length) message.error(errors[0])
    else setEditing(false)
  }

  const cell = (t: Named, l: Lift) => {
    const k = key(t.id, l.id)
    const c = current[k]
    const p = pending[k]
    if (editing && !p)
      return (
        <InputNumber
          className="lr-input"
          min={0}
          step={0.5}
          value={draft[k] ?? undefined}
          placeholder={tx('রেট')}
          addonAfter="৳"
          onChange={(v) => setDraft((d) => ({ ...d, [k]: v === null ? null : Number(v) }))}
        />
      )
    return (
      <div className="lr-cell">
        <b>{c?.rate != null ? `${money(c.rate)} ৳` : '—'}</b>
        {c?.rate != null ? (
          <Tag className="fl-tag fl-tag-green">{tx('চালু')}</Tag>
        ) : (
          !p && <span className="lr-muted">{tx('রেট নেই')}</span>
        )}
        {c?.next_rate != null && (
          <span className="lr-muted">
            {tx('{{p0}} থেকে {{p1}} ৳', { p0: fmtDate(c.next_from), p1: money(c.next_rate) })}
          </span>
        )}
        {p && (
          <Tooltip title={tx('অনুমোদন দেখুন')}>
            <Tag className="fl-tag fl-tag-gold lr-pending" onClick={() => p.approval_request_id && navigate(`/approvals/${p.approval_request_id}`)}>
              {tx('অনুমোদনের অপেক্ষায়')}: {money(Number(p.rate))} ৳ <EyeFilled />
            </Tag>
          </Tooltip>
        )}
      </div>
    )
  }

  const columns: ColumnsType<Named> = [
    { title: tx('সেচের উৎস'), dataIndex: 'name_bn', fixed: 'left', render: (v) => <span className="fl-name">{v}</span> },
    ...lifts.map((l) => ({ title: nameOf(l), key: l.id, align: 'center' as const, render: (_: unknown, t: Named) => cell(t, l) })),
  ]

  const cards = [
    { key: 'lifts', label: tx('লিফট'), value: liftList ? lifts.length : undefined, icon: 'layers', color: '#1769e0', tint: '#e4edfd', onClick: () => navigate('/irrigation/rates?view=lifts') },
    { key: 'rates', label: tx('চালু লিফট রেট'), value: data ? filled : undefined, icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5' },
    { key: 'pending', label: tx('অনুমোদনের অপেক্ষায়'), value: data ? Object.keys(pending).length : undefined, icon: 'bars', color: '#f08c00', tint: '#fdefd6', onClick: () => navigate('/approvals') },
    { key: 'nolift', label: tx('লিফট বসানো নেই এমন জমি'), value: liftList?.without_lift, icon: 'drop', color: '#e5383b', tint: '#fde4e5', onClick: () => navigate('/lands?lift_id=none') },
  ]

  return (
    <ListFrame
      above={tabs}
      section={{ label: tx('সেচ'), to: '/irrigation/invoices' }}
      title={tx('লিফট অনুযায়ী রেট')}
      subtitle={tx('প্রতিটি সেচের উৎসে কোন লিফটের জমির রেট কত (প্রতি শতক)।')}
      actions={
        canEdit &&
        !editing && (
          <Button type="primary" icon={<EditFilled />} onClick={startEdit} disabled={!lifts.length}>
            {tx('রেট লিখুন')}
          </Button>
        )
      }
      cards={cards}
      filterClass="rt-filters"
      filters={
        <Field label={tx('মৌসুম')} grow={320}>
          <Select
            value={season?.id}
            placeholder={tx('মৌসুম বাছাই করুন')}
            options={seasons.map((s) => ({ value: s.id, label: s.name_bn }))}
            onChange={(v) => {
              setSeasonId(Number(v))
              setEditing(false)
            }}
          />
        </Field>
      }
      tableTitle={season ? tx('{{p0}} — লিফট অনুযায়ী রেট', { p0: season.name_bn }) : tx('লিফট অনুযায়ী রেট')}
    >
      {!seasons.length && <Alert type="info" showIcon message={tx('আগে একটি মৌসুম তৈরি করুন।')} />}
      <Table<Named> className="fl-table ml-table pl-table rt-table lr-table" rowKey="id" loading={isFetching} dataSource={types} pagination={false} scroll={{ x: 'max-content' }} columns={columns} />
      {editing && (
        <div className="lr-send">
          <Field label={tx('কার্যকর শুরু')}>
            <DatePicker prefix={<CalendarOutlined />} format="DD/MM/YYYY" value={from} allowClear={false} onChange={(d) => d && setFrom(d)} />
          </Field>
          <Field label={tx('কারণ')} grow={320}>
            <Input value={reason} maxLength={500} placeholder={tx('যেমন: নতুন মৌসুমের রেট')} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="lr-send-btns">
            <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>
              {tx('বাতিল')}
            </Button>
            <Button type="primary" icon={<SendOutlined />} loading={saving} disabled={!changed.length} onClick={send}>
              {tx('অনুমোদনের জন্য পাঠান ({{p0}})', { p0: n0(changed.length) })}
            </Button>
          </div>
        </div>
      )}
      <div className="rt-note">
        <InfoCircleFilled />
        <div>
          <strong>{tx('নোট')}</strong>
          <ul>
            <li>{tx('জমির ফর্মে প্রতিটি জমির লিফট বসান; ইনভয়েসে সেই লিফটের রেট নিজে বসবে।')}</li>
            <li>{tx('কোনো উৎসে একবার লিফটের রেট চালু হলে লিফট বসানো নেই এমন জমির বিল হবে না — আগে লিফট বসান।')}</li>
            <li>{tx('প্রতিটি নতুন বা বদলানো রেট ম্যানেজারের অনুমোদনের পর চালু হয়।')}</li>
            <li>{tx('একই লিফটে জমির ধরন অনুযায়ী আলাদা রেট লাগলে "রেটের তালিকা" থেকে "একটি রেট" দিন।')}</li>
          </ul>
        </div>
      </div>
    </ListFrame>
  )
}
