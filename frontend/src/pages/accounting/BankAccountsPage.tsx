import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, DatePicker, Drawer, Form, Grid, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BankFilled, CalendarFilled, CheckOutlined, EditFilled, FileTextFilled, PlusCircleOutlined, PlusOutlined, SafetyCertificateFilled, SearchOutlined, SwapOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundTxnModal, { type FundTxnKind } from '../../components/FundTxnModal'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { BANK_TYPE_LABEL, money, moneyOrBlank, type LedgerReport, type LedgerRow } from '../../lib/accounting'
import { digits, fmtDate, toEnDigits } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../loans/loans.css'
import './accounting.css'

type Bank = {
  id: number
  account_id: number
  bank_name: string
  branch_name: string | null
  account_no: string
  account_type: string
  opened_on: string | null
  fdr_maturity_date: string | null
  fdr_interest_rate: number | null
  is_active: boolean
  remarks: string | null
  balance: number
  account: { id: number; code: string; name_bn: string; name_en: string | null }
}

type Statement = LedgerReport & { unreconciled: { n: number; amount: number } }

function StatementDrawer({ bank, onClose }: { bank: Bank | null; onClose: () => void }) {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()])
  const [from, to] = range.map((d) => d.format('YYYY-MM-DD'))

  const { data, isFetching } = useQuery({
    queryKey: ['bank-statement', bank?.id, from, to],
    enabled: !!bank,
    queryFn: async () => (await api.get<Statement>(`/bank-accounts/${bank!.id}/statement`, { params: { from, to } })).data,
  })

  const toggle = async (r: LedgerRow, reconciled: boolean) => {
    try {
      await api.post(`/bank-accounts/${bank!.id}/lines/${r.line_id}/reconcile`, { reconciled })
      queryClient.invalidateQueries({ queryKey: ['bank-statement', bank!.id] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <Drawer open={!!bank} onClose={onClose} size="large" title={bank ? `${bank.bank_name} — ${digits(bank.account_no)}` : ''}>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} value={range} onChange={(r) => r?.[0] && r?.[1] && setRange([r[0], r[1]])} />
      </Space>
      {data && (
        <Alert
          type={data.unreconciled.n ? 'warning' : 'success'}
          showIcon
          style={{ marginBottom: 12 }}
          title={
            data.unreconciled.n
              ? tx('ব্যাংক স্টেটমেন্টের সাথে মেলানো বাকি: {{p0}}টি লেনদেন, নিট {{p1}} টাকা', { p0: digits(data.unreconciled.n), p1: money(data.unreconciled.amount) })
              : tx('সব লেনদেন ব্যাংক স্টেটমেন্টের সাথে মেলানো হয়েছে।')
          }
        />
      )}
      <Typography.Paragraph type="secondary">{tx('ব্যাংকের নিজস্ব স্টেটমেন্টে যে লেনদেন দেখা গেছে, তাতে টিক দিন।')}</Typography.Paragraph>
      <Table<LedgerRow>
        rowKey="line_id"
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={false}
        scroll={{ x: 640 }}
        title={() =>
          data ? (
            <span>
              {tx('প্রারম্ভিক জের')}: <b>{money(data.opening)}</b>
            </span>
          ) : null
        }
        columns={[
          {
            title: tx('মিলেছে'),
            width: 70,
            render: (_, r) => <Checkbox checked={!!r.reconciled_at} disabled={!can('bank.edit')} onChange={(e) => toggle(r, e.target.checked)} />,
          },
          { title: tx('তারিখ'), dataIndex: 'date', width: 100, render: fmtDate },
          { title: tx('ভাউচার নং'), dataIndex: 'voucher_no', width: 130, render: digits },
          { title: tx('বিবরণ'), render: (_, r) => r.narration || r.against.map((a) => nameOf(a)).join(', ') },
          { title: tx('জমা'), dataIndex: 'debit', width: 110, align: 'right', render: moneyOrBlank },
          { title: tx('উত্তোলন'), dataIndex: 'credit', width: 110, align: 'right', render: moneyOrBlank },
          { title: tx('জের'), dataIndex: 'balance', width: 120, align: 'right', render: money },
        ]}
        summary={() =>
          data ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <b>{tx('সমাপনী জের')}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <b>{money(data.total_debit)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <b>{money(data.total_credit)}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <b>{money(data.closing)}</b>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null
        }
      />
    </Drawer>
  )
}

type Filters = { search?: string; type?: string; active?: string }

/** Bank (and FDR) accounts with their balance; statement matching, transfers and deposits from each row. */
export default function BankAccountsPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const wide = Grid.useBreakpoint().lg
  const [editing, setEditing] = useState<Bank | 'new' | null>(null)
  const [statement, setStatement] = useState<Bank | null>(null)
  const [txn, setTxn] = useState<{ kind: FundTxnKind; fundId: number } | null>(null)
  const [draft, setDraft] = useState<Filters>({})
  const [filters, setFilters] = useState<Filters>({})
  const [form] = Form.useForm()
  const accountType = Form.useWatch('account_type', form)

  const { data, isLoading } = useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get<{ data: Bank[] }>('/bank-accounts')).data.data })
  const all = data ?? []
  const q = toEnDigits(filters.search ?? '').toLowerCase()
  const rows = all.filter(
    (b) =>
      (!q ||
        toEnDigits(`${b.bank_name} ${b.branch_name ?? ''} ${b.account_no} ${b.account.code}`)
          .toLowerCase()
          .includes(q)) &&
      (!filters.type || b.account_type === filters.type) &&
      (!filters.active || String(b.is_active) === filters.active),
  )
  const sum = (list: Bank[]) => list.reduce((s, b) => s + Number(b.balance), 0)
  const fdr = all.filter((b) => b.account_type === 'fdr')
  const soon = dayjs().add(30, 'day').format('YYYY-MM-DD')
  const maturing = fdr.filter((b) => b.is_active && b.fdr_maturity_date && b.fdr_maturity_date <= soon)
  const show = (f: Filters) => {
    setDraft(f)
    setFilters(f)
  }

  const open = (b: Bank | 'new') => {
    setEditing(b)
    form.resetFields()
    form.setFieldsValue(b === 'new' ? { account_type: 'current', is_active: true } : { ...b, opened_on: b.opened_on ? dayjs(b.opened_on) : null, fdr_maturity_date: b.fdr_maturity_date ? dayjs(b.fdr_maturity_date) : null })
  }

  const save = async () => {
    const v = await form.validateFields()
    const payload = {
      ...v,
      opened_on: v.opened_on ? (v.opened_on as Dayjs).format('YYYY-MM-DD') : null,
      fdr_maturity_date: v.fdr_maturity_date ? (v.fdr_maturity_date as Dayjs).format('YYYY-MM-DD') : null,
    }
    try {
      if (editing === 'new') await api.post('/bank-accounts', payload)
      else await api.put(`/bank-accounts/${(editing as Bank).id}`, payload)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(null)
      for (const k of ['bank-accounts', 'funds', 'account-options', 'accounts']) queryClient.invalidateQueries({ queryKey: [k] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const cards = [
    { key: 'total', label: tx('মোট ব্যাংক জের'), value: data ? `৳ ${money(sum(all))}` : undefined, icon: '', glyph: <BankFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show({}) },
    {
      key: 'active',
      label: tx('সক্রিয় হিসাব · মোট {{p0}}টি', { p0: n0(all.length) }),
      value: data ? all.filter((b) => b.is_active).length : undefined,
      icon: '',
      solid: <CheckOutlined />,
      color: '#1f9d55',
      tint: '#dcf3e5',
      onClick: () => show({ active: 'true' }),
    },
    {
      key: 'fdr',
      label: tx('এফডিআর · {{p0}}টি', { p0: n0(fdr.length) }),
      value: data ? `৳ ${money(sum(fdr))}` : undefined,
      icon: '',
      glyph: <SafetyCertificateFilled />,
      color: '#8b3fe0',
      tint: '#efe4fc',
      onClick: () => show({ type: 'fdr' }),
    },
    { key: 'soon', label: tx('৩০ দিনে মেয়াদপূর্তি (এফডিআর)'), value: data ? maturing.length : undefined, icon: '', glyph: <CalendarFilled />, color: '#f08c00', tint: '#fdefd6', onClick: () => show({ type: 'fdr' }) },
  ]
  const opts = (m: Record<string, string>) => [{ value: '', label: tx('সকল') }, ...Object.entries(m).map(([value, label]) => ({ value, label }))]

  const columns: ColumnsType<Bank> = [
    { title: tx('কোড'), render: (_, b) => <span className="iv-no">{digits(b.account.code)}</span> },
    {
      title: tx('ব্যাংক ও শাখা'),
      render: (_, b) => (
        <span className="hs-two">
          <span className="mg-name">{b.bank_name}</span>
          <span>{b.branch_name || '—'}</span>
        </span>
      ),
    },
    { title: tx('হিসাব নং'), dataIndex: 'account_no', render: (v: string) => <span className="iv-no">{digits(v)}</span> },
    {
      title: tx('ধরন'),
      dataIndex: 'account_type',
      render: (t: string, b) => (
        <span className="hs-two">
          <Tag className={`fl-tag ${t === 'fdr' ? 'll-purple' : t === 'savings' ? 'fl-tag-green' : 'll-blue'}`}>{BANK_TYPE_LABEL[t] ?? t}</Tag>
          {t === 'fdr' && b.fdr_maturity_date && <span className={b.fdr_maturity_date <= soon ? 'ac-warn' : undefined}>{tx('মেয়াদপূর্তি: {{p0}}', { p0: fmtDate(b.fdr_maturity_date) })}</span>}
        </span>
      ),
    },
    { title: tx('জের (৳)'), dataIndex: 'balance', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
    { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag className="fl-tag iv-status fl-tag-green">{tx('সক্রিয়')}</Tag> : <Tag className="fl-tag iv-status ll-gray">{tx('নিষ্ক্রিয়')}</Tag>) },
    {
      title: tx('অ্যাকশন'),
      width: 210,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, b) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<FileTextFilled />} aria-label={tx('স্টেটমেন্ট')} title={tx('স্টেটমেন্ট ও মিলকরণ')} onClick={() => setStatement(b)} />
          {can('bank.create') && b.is_active && (
            <>
              <Button className="fl-act pl-act" icon={<PlusCircleOutlined />} aria-label={tx('জমা')} title={tx('জমা')} onClick={() => setTxn({ kind: 'receipt', fundId: b.account_id })} />
              <Button className="fl-act pl-act" icon={<SwapOutlined />} aria-label={tx('স্থানান্তর')} title={tx('স্থানান্তর')} onClick={() => setTxn({ kind: 'transfer', fundId: b.account_id })} />
            </>
          )}
          {can('bank.edit') && <Button className="fl-act pl-act" icon={<EditFilled />} aria-label={tx('সম্পাদনা')} title={tx('সম্পাদনা')} onClick={() => open(b)} />}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('হিসাব'), to: '/accounting/summary' }}
      title={tx('ব্যাংক হিসাব')}
      subtitle=""
      actions={
        can('bank.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন ব্যাংক হিসাব')}
          </Button>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('খুঁজুন')} grow={300}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder={tx('ব্যাংক, শাখা বা হিসাব নং...')}
              value={draft.search}
              onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
              onPressEnter={() => setFilters(draft)}
            />
          </Field>
          <Field label={tx('ধরন')}>
            <Select value={draft.type ?? ''} options={opts(BANK_TYPE_LABEL)} onChange={(v) => setDraft((d) => ({ ...d, type: v || undefined }))} />
          </Field>
          <Field label={tx('অবস্থা')}>
            <Select value={draft.active ?? ''} options={opts({ true: tx('সক্রিয়'), false: tx('নিষ্ক্রিয়') })} onChange={(v) => setDraft((d) => ({ ...d, active: v || undefined }))} />
          </Field>
        </>
      }
      onSearch={() => setFilters(draft)}
      onReset={() => show({})}
      tableTitle={tx('{{p0}} ({{p1}})', { p0: tx('ব্যাংক হিসাবের তালিকা'), p1: n0(rows.length) })}
    >
      <Table<Bank>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('কোনো ব্যাংক হিসাব নেই') }}
        summary={() =>
          rows.length > 1 ? (
            <Table.Summary.Row className="ln-sum-row">
              <Table.Summary.Cell index={0} colSpan={4}>
                {tx('মোট')}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                {money(sum(rows))}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={2} />
            </Table.Summary.Row>
          ) : null
        }
      />

      <Modal open={!!editing} forceRender title={editing === 'new' ? tx('নতুন ব্যাংক হিসাব') : tx('ব্যাংক হিসাব সম্পাদনা')} onCancel={() => setEditing(null)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        {editing === 'new' && <Alert type="info" showIcon style={{ marginBottom: 12 }} title={tx('হিসাবের তালিকায় "ব্যাংক হিসাবসমূহ"-এর অধীনে স্বয়ংক্রিয়ভাবে একটি হিসাব খোলা হবে। শুরুর জের থাকলে প্রারম্ভিক জের এন্ট্রি দিন।')} />}
        <Form form={form} layout="vertical">
          <Form.Item name="bank_name" label={tx('ব্যাংকের নাম')} rules={[required(tx('ব্যাংকের নাম দিন'))]}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="branch_name" label={tx('শাখা')}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="account_no" label={tx('হিসাব নং')} rules={[required(tx('হিসাব নং দিন'))]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="account_type" label={tx('ধরন')} rules={[required(tx('ধরন বাছাই করুন'))]}>
            <Select options={Object.entries(BANK_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="opened_on" label={tx('খোলার তারিখ')}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          {accountType === 'fdr' && (
            <Space size="large" wrap>
              <Form.Item name="fdr_maturity_date" label={tx('মেয়াদপূর্তির তারিখ')} rules={[required(tx('তারিখ দিন'))]}>
                <DatePicker format="DD/MM/YYYY" />
              </Form.Item>
              <Form.Item name="fdr_interest_rate" label={tx('সুদের হার (%)')}>
                <InputNumber min={0} max={100} step={0.25} />
              </Form.Item>
            </Space>
          )}
          <Form.Item name="is_active" label={tx('অবস্থা')} valuePropName="checked">
            <Switch checkedChildren={tx('সক্রিয়')} unCheckedChildren={tx('নিষ্ক্রিয়')} />
          </Form.Item>
          <Form.Item name="remarks" label={tx('মন্তব্য')}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <StatementDrawer bank={statement} onClose={() => setStatement(null)} />
      <FundTxnModal kind={txn?.kind ?? null} fundId={txn?.fundId} onClose={() => setTxn(null)} />
    </ListFrame>
  )
}
