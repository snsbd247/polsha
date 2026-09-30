import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Grid, Input, Modal, Popconfirm, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CalendarFilled, ClockCircleFilled, LockFilled, LockOutlined, UnlockOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import './accounting.css'

type Period = {
  id: number
  period_key: string
  fiscal_year: string
  start_date: string
  end_date: string
  status: 'open' | 'closed'
  closed_at: string | null
  closer: { name_bn: string; name_en: string | null } | null
  posted_count: number
  pending_count: number
}
type Filters = { fiscal_year?: string; status?: string }

/** Accounting months: close a finished month so nothing more can be posted to it, or reopen it with a reason. */
export default function PeriodsPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [reopen, setReopen] = useState<Period | null>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({ queryKey: ['accounting-periods'], queryFn: async () => (await api.get<Period[]>('/accounting/periods')).data })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounting-periods'] })
  const all = data ?? []
  const rows = all.filter((p) => (!filters.fiscal_year || p.fiscal_year === filters.fiscal_year) && (!filters.status || p.status === filters.status))
  const years = [...new Set(all.map((p) => p.fiscal_year))]
  const closed = all.filter((p) => p.status === 'closed')
  const lastClosed = closed
    .map((p) => p.period_key)
    .sort()
    .at(-1)
  const pending = all.reduce((s, p) => s + Number(p.pending_count), 0)
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
  }

  const close = async (p: Period) => {
    try {
      await api.post(`/accounting/periods/${p.id}/close`)
      message.success(tx('মাস বন্ধ হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const submitReopen = async () => {
    const v = await form.validateFields()
    try {
      await api.post(`/accounting/periods/${reopen!.id}/reopen`, v)
      message.success(tx('মাস আবার খোলা হয়েছে।'))
      setReopen(null)
      refresh()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'open', label: tx('খোলা মাস'), value: data ? all.length - closed.length : undefined, icon: '', glyph: <UnlockOutlined />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show({ status: 'open' }) },
    { key: 'closed', label: tx('বন্ধ মাস'), value: data ? closed.length : undefined, icon: '', glyph: <LockFilled />, color: '#e5383b', tint: '#fde4e5', onClick: () => show({ status: 'closed' }) },
    { key: 'pending', label: tx('অনুমোদনের অপেক্ষায় ভাউচার'), value: data ? pending : undefined, icon: '', glyph: <ClockCircleFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => navigate('/accounting/journals') },
    { key: 'last', label: tx('সর্বশেষ বন্ধ মাস'), value: data ? (lastClosed ? digits(lastClosed) : '—') : undefined, icon: '', glyph: <CalendarFilled />, color: '#1769e0', tint: '#e4edfd' },
  ]

  const columns: ColumnsType<Period> = [
    { title: tx('মাস'), dataIndex: 'period_key', render: (v: string) => <span className="iv-no">{digits(v)}</span> },
    { title: tx('অর্থবছর'), dataIndex: 'fiscal_year', render: digits },
    { title: tx('সময়কাল'), render: (_, p) => `${fmtDate(p.start_date)} — ${fmtDate(p.end_date)}` },
    { title: tx('পোস্টেড ভাউচার'), dataIndex: 'posted_count', align: 'right', render: (n: number) => n0(n) },
    { title: tx('অপেক্ষমাণ'), dataIndex: 'pending_count', align: 'center', render: (n: number) => (n ? <Tag className="fl-tag fl-tag-gold">{digits(n)}</Tag> : '—') },
    {
      title: tx('অবস্থা'),
      render: (_, p) =>
        p.status === 'closed' ? (
          <span className="hs-two">
            <Tag className="fl-tag iv-status fl-tag-red">{tx('বন্ধ')}</Tag>
            <span>
              {nameOf(p.closer)} · {fmtDateTime(p.closed_at)}
            </span>
          </span>
        ) : (
          <Tag className="fl-tag iv-status fl-tag-green">{tx('খোলা')}</Tag>
        ),
    },
    {
      title: tx('অ্যাকশন'),
      width: 150,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, p) =>
        !can('accounting.approve') ? null : p.status === 'open' ? (
          <Popconfirm title={tx('{{p0}} মাস বন্ধ করবেন?', { p0: digits(p.period_key) })} okText={tx('হ্যাঁ')} cancelText={tx('না')} onConfirm={() => close(p)}>
            <Button size="small" icon={<LockOutlined />} disabled={!dayjs(p.end_date).isBefore(dayjs(), 'day')}>
              {tx('মাস বন্ধ করুন')}
            </Button>
          </Popconfirm>
        ) : (
          <Button
            size="small"
            danger
            icon={<UnlockOutlined />}
            onClick={() => {
              form.resetFields()
              setReopen(p)
            }}
          >
            {tx('আবার খুলুন')}
          </Button>
        ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('হিসাবকাল বন্ধ')}
      subtitle=""
      cards={cards}
      above={<Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('মাস বন্ধ করলে ওই মাসের তারিখে আর কোনো লেনদেন বা সংশোধন করা যাবে না। প্রথম লেনদেনের সময় মাস স্বয়ংক্রিয়ভাবে খোলে।')} />}
      filters={
        <>
          <Field label={tx('অর্থবছর')} grow={260}>
            <Select value={draft.fiscal_year ?? ''} options={[{ value: '', label: tx('সকল') }, ...years.map((y) => ({ value: y, label: digits(y) }))]} onChange={(v) => setDraft((d) => ({ ...d, fiscal_year: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select
              value={draft.status ?? ''}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'open', label: tx('খোলা') },
                { value: 'closed', label: tx('বন্ধ') },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
            />
          </Field>
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('হিসাবকালের তালিকা'), p1: n0(rows.length) })}
    >
      <Table<Period>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={rows.length > 24 ? { pageSize: 24, hideOnSinglePage: true } : false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('এখনও কোনো হিসাবকাল নেই') }}
      />
      <Modal
        open={!!reopen}
        forceRender
        title={reopen ? tx('{{p0}} মাস আবার খুলুন', { p0: digits(reopen.period_key) }) : ''}
        onCancel={() => setReopen(null)}
        onOk={submitReopen}
        okText={tx('আবার খুলুন')}
        cancelText={tx('বাতিল')}
        okButtonProps={{ danger: true }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </ListFrame>
  )
}
