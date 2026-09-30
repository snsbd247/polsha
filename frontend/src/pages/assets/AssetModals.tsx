import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { api, applyFormErrors, errorMessage, type Paginated } from '../../lib/api'
import { accountLabel, money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { METHOD_LABEL } from '../../lib/irrigation'
import { toOptions } from '../../lib/phase2'
import { useAssetFunds, useAssetMeta } from '../../lib/phase8'
import { required } from '../../lib/rules'
import { nameOf, t as tx } from '../../lib/i18n'
import type { AssetRow } from './AssetListPage'

/** The asset forms (move, schedule, complete, dispose) — opened from the asset page and from the Transfer / Installation / Repair / Schedule lists. */

export type JournalRef = { id: number; voucher_no: string } | null
type Person = { id: number; name_bn: string; name_en: string | null } | null
export type Movement = {
  id: number
  type: string
  date: string
  from_location: string | null
  to_location: string | null
  custodian: string | null
  condition: string | null
  amount: string | null
  note: string | null
  journal: JournalRef
  creator: Person
}
export type Maintenance = {
  id: number
  asset_id: number
  kind: string
  title: string
  due_on: string | null
  repeat_months: number | null
  done_on: string | null
  cost: string | null
  vendor: string | null
  status: string
  note: string | null
  journal: JournalRef
}
export type Depreciation = { id: number; period: string; amount: string; accumulated_after: string; book_value_after: string; journal: JournalRef }
export type Detail = AssetRow & {
  supplier: string | null
  remarks: string | null
  reference: string | null
  method: string | null
  depreciation_from: string
  fund: { id: number; code: string; name_bn: string; name_en: string | null } | null
  journal: JournalRef
  creator: Person
  disposal: { type: string; date: string; price: number; reason: string; buyer: string | null } | null
  movements: Movement[]
  maintenances: Maintenance[]
  depreciations: Depreciation[]
  monthly_charge: number
  remaining: number
  months_left: number
}

export type MoveType = 'transfer' | 'install' | 'uninstall' | 'condition' | 'repair' | 'repaired'
export const LIVE = ['in_stock', 'installed', 'in_repair']
/** Which asset statuses each move can start from. */
export const ALLOWED: Record<MoveType, string[]> = {
  transfer: LIVE,
  install: ['in_stock'],
  uninstall: ['installed'],
  condition: LIVE,
  repair: ['in_stock', 'installed'],
  repaired: ['in_repair'],
}
export const MOVE_LABEL: Record<MoveType, string> = {
  transfer: tx('স্থানান্তর'),
  install: tx('স্থাপন'),
  uninstall: tx('স্টকে ফেরত'),
  condition: tx('অবস্থা পরিবর্তন'),
  repair: tx('মেরামতে পাঠান'),
  repaired: tx('মেরামত শেষ'),
}

export const journalLink = (j: JournalRef, canView: boolean) => (j ? canView ? <Link to={`/accounting/journals/${j.id}`}>{digits(j.voucher_no)}</Link> : digits(j.voucher_no) : null)

/** What the forms need to know about the asset. */
export type AssetLike = Pick<AssetRow, 'id' | 'asset_code' | 'name_bn' | 'name_en' | 'location' | 'custodian' | 'book_value' | 'status'>

/** Step one of a move/schedule started from a list: pick the asset (only ones whose status allows it). */
export function AssetPickModal({ open, title, statuses, onPick, onClose }: { open: boolean; title: string; statuses: string[]; onPick: (a: AssetRow) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<AssetRow | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['assets', 'pick', search],
    enabled: open,
    queryFn: async () => (await api.get<Paginated<AssetRow>>('/assets', { params: { status: 'active', search: search || undefined, per_page: 30 } })).data.data,
  })
  const options = (data ?? []).filter((a) => statuses.includes(a.status))
  const close = () => {
    setPicked(null)
    setSearch('')
    onClose()
  }
  return (
    <Modal open={open} title={title} okText={tx('পরবর্তী')} cancelText={tx('বাতিল')} okButtonProps={{ disabled: !picked }} onCancel={close} onOk={() => picked && (onPick(picked), close())}>
      <Form layout="vertical">
        <Form.Item label={tx('সম্পদ')} required extra={picked ? tx('বর্তমান অবস্থান: {{p0}}', { p0: picked.location ?? '—' }) : undefined}>
          <Select
            showSearch={{ filterOption: false, onSearch: setSearch }}
            placeholder={tx('কোড বা নাম লিখে খুঁজুন')}
            loading={isFetching}
            value={picked?.id}
            options={options.map((a) => ({ value: a.id, label: `${digits(a.asset_code)} — ${nameOf(a)}` }))}
            onChange={(id) => setPicked(options.find((a) => a.id === id) ?? null)}
            notFoundContent={isFetching ? undefined : tx('এমন কোনো সম্পদ নেই')}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type ModalProps = { asset: AssetLike; onClose: () => void; onDone: () => void }

export function MovementModal({ asset, type, onClose, onDone }: ModalProps & { type: MoveType | null }) {
  const { message } = App.useApp()
  const meta = useAssetMeta()
  const [form] = Form.useForm()
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/movements`, { ...v, type, date: (v.date as Dayjs).format('YYYY-MM-DD') })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={!!type} forceRender destroyOnHidden title={type ? `${MOVE_LABEL[type]} — ${digits(asset.asset_code)} ${nameOf(asset)}` : ''} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ date: dayjs() }}>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        {(type === 'transfer' || type === 'install' || type === 'uninstall') && (
          <Form.Item name="to_location" label={tx('নতুন অবস্থান')} rules={type === 'transfer' ? [required(tx('অবস্থান লিখুন'))] : []} extra={tx('বর্তমান: {{p0}}', { p0: asset.location ?? '—' })}>
            <Input maxLength={200} />
          </Form.Item>
        )}
        {type !== 'condition' && (
          <Form.Item name="custodian" label={tx('দায়িত্বপ্রাপ্ত')} extra={tx('বর্তমান: {{p0}}', { p0: asset.custodian ?? '—' })}>
            <Input maxLength={150} />
          </Form.Item>
        )}
        {(type === 'condition' || type === 'repaired') && (
          <Form.Item name="condition" label={tx('অবস্থা')} rules={type === 'condition' ? [required(tx('অবস্থা বাছাই করুন'))] : []}>
            <Select options={toOptions(meta.data?.conditions)} />
          </Form.Item>
        )}
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function ScheduleModal({ asset, open, onClose, onDone }: ModalProps & { open: boolean }) {
  const { message } = App.useApp()
  const meta = useAssetMeta()
  const [form] = Form.useForm()
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/maintenances`, { ...v, due_on: (v.due_on as Dayjs | undefined)?.format('YYYY-MM-DD') })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} forceRender title={`${tx('সার্ভিস/মেরামত নির্ধারণ')} — ${digits(asset.asset_code)} ${nameOf(asset)}`} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'service' }}>
        <Form.Item name="kind" label={tx('ধরন')}>
          <Select options={toOptions(meta.data?.maintenance_kinds)} />
        </Form.Item>
        <Form.Item name="title" label={tx('কাজ')} rules={[required(tx('কাজের বিবরণ লিখুন'))]}>
          <Input maxLength={200} placeholder={tx('যেমন: মোটর সার্ভিসিং')} />
        </Form.Item>
        <Form.Item name="due_on" label={tx('নির্ধারিত তারিখ')}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="repeat_months" label={tx('পুনরাবৃত্তি (মাস পর পর)')} extra={tx('সম্পন্ন হলে পরের কাজ স্বয়ংক্রিয়ভাবে নির্ধারিত হবে।')}>
          <InputNumber min={1} max={120} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const PAY_METHODS: Record<string, string> = { ...METHOD_LABEL, credit: tx('বাকিতে') }

export function CompleteModal({ job, onClose, onDone }: { job: Maintenance | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp()
  const funds = useAssetFunds()
  const [form] = Form.useForm()
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const cost: number | undefined = Form.useWatch('cost', form)
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v || !job) return
    try {
      await api.post(`/assets/maintenances/${job.id}/complete`, {
        ...v,
        done_on: (v.done_on as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.method !== 'cash' && v.method !== 'credit' ? v.fund_account_id : null,
      })
      message.success(tx('সংরক্ষণ হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={!!job} forceRender title={tx('কাজ সম্পন্ন — {{p0}}', { p0: job?.title ?? '' })} onCancel={onClose} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
      <Form form={form} layout="vertical" initialValues={{ done_on: dayjs(), method: 'cash' }}>
        <Form.Item name="done_on" label={tx('সম্পন্নের তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="cost" label={tx('খরচ')} extra={tx('খরচ দিলে মেরামত খরচের ভাউচার হবে।')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="৳" />
        </Form.Item>
        {!!cost && (
          <>
            <Form.Item name="method" label={tx('পরিশোধের মাধ্যম')}>
              <Select options={toOptions(PAY_METHODS)} />
            </Form.Item>
            {method !== 'cash' && method !== 'credit' && (
              <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                <Select loading={funds.isFetching} options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((f) => ({ value: f.id, label: accountLabel(f) }))} />
              </Form.Item>
            )}
            {method !== 'cash' && (
              <Form.Item name="reference" label={tx('রেফারেন্স')}>
                <Input maxLength={100} />
              </Form.Item>
            )}
          </>
        )}
        <Form.Item name="vendor" label={tx('মেকানিক / প্রতিষ্ঠান')}>
          <Input maxLength={150} />
        </Form.Item>
        <Form.Item name="note" label={tx('নোট')}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function DisposeModal({ asset, open, onClose, onDone }: ModalProps & { open: boolean }) {
  const { message } = App.useApp()
  const funds = useAssetFunds()
  const [form] = Form.useForm()
  const type: string = Form.useWatch('type', form) ?? 'sale'
  const method: string = Form.useWatch('method', form) ?? 'cash'
  const price: number = Form.useWatch('price', form) ?? 0
  const gain = price - asset.book_value
  const save = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    try {
      await api.post(`/assets/${asset.id}/dispose`, {
        ...v,
        date: (v.date as Dayjs).format('YYYY-MM-DD'),
        fund_account_id: v.type === 'sale' && v.method !== 'cash' ? v.fund_account_id : null,
      })
      message.success(tx('অনুমোদনের জন্য পাঠানো হয়েছে।'))
      form.resetFields()
      onClose()
      onDone()
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }
  return (
    <Modal open={open} forceRender title={tx('সম্পদ বিক্রয় / বাতিল')} onCancel={onClose} onOk={save} okText={tx('অনুমোদনে পাঠান')} cancelText={tx('বাতিল')}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('বর্তমান মূল্য ৳{{p0}}। অনুমোদনের পর সম্পদ হিসাব থেকে বাদ যাবে এবং লাভ/ক্ষতির ভাউচার হবে।', { p0: money(asset.book_value) })} />
      <Form form={form} layout="vertical" initialValues={{ type: 'sale', date: dayjs(), method: 'cash' }}>
        <Form.Item name="type" label={tx('ধরন')}>
          <Select
            options={[
              { value: 'sale', label: tx('বিক্রয়') },
              { value: 'writeoff', label: tx('বাতিল (অকেজো)') },
            ]}
          />
        </Form.Item>
        <Form.Item name="date" label={tx('তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        {type === 'sale' && (
          <>
            <Form.Item name="price" label={tx('বিক্রয়মূল্য')} rules={[required(tx('বিক্রয়মূল্য দিন'))]} extra={price ? (gain >= 0 ? tx('লাভ: ৳{{p0}}', { p0: money(gain) }) : tx('ক্ষতি: ৳{{p0}}', { p0: money(-gain) })) : undefined}>
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="৳" />
            </Form.Item>
            <Form.Item name="buyer" label={tx('ক্রেতা')}>
              <Input maxLength={150} />
            </Form.Item>
            <Form.Item name="method" label={tx('মাধ্যম')}>
              <Select options={toOptions(METHOD_LABEL)} />
            </Form.Item>
            {method !== 'cash' && (
              <>
                <Form.Item name="fund_account_id" label={method === 'bank' ? tx('ব্যাংক হিসাব') : tx('তহবিল হিসাব')} rules={[required(tx('হিসাব বাছাই করুন'))]}>
                  <Select loading={funds.isFetching} options={(funds.data ?? []).filter((f) => (method === 'bank' ? f.kind === 'bank' : true)).map((f) => ({ value: f.id, label: accountLabel(f) }))} />
                </Form.Item>
                <Form.Item name="reference" label={tx('রেফারেন্স')} rules={[required(tx('রেফারেন্স দিন'))]}>
                  <Input maxLength={100} />
                </Form.Item>
              </>
            )}
          </>
        )}
        <Form.Item name="reason" label={tx('কারণ')} rules={[required(tx('কারণ লিখুন'))]}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
