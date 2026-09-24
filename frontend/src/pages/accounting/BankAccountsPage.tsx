import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Can, useAuth } from '../../auth/AuthContext'
import FundTxnModal, { type FundTxnKind } from '../../components/FundTxnModal'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { BANK_TYPE_LABEL, money, moneyOrBlank, type LedgerReport, type LedgerRow } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'
import { required } from '../../lib/rules'

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
        title={() => (data ? <span>{tx('প্রারম্ভিক জের')}: <b>{money(data.opening)}</b></span> : null)}
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

export default function BankAccountsPage() {
  const { can } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Bank | 'new' | null>(null)
  const [statement, setStatement] = useState<Bank | null>(null)
  const [txn, setTxn] = useState<{ kind: FundTxnKind; fundId: number } | null>(null)
  const [form] = Form.useForm()
  const accountType = Form.useWatch('account_type', form)

  const { data, isLoading } = useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get<{ data: Bank[] }>('/bank-accounts')).data.data })

  const open = (b: Bank | 'new') => {
    setEditing(b)
    form.resetFields()
    form.setFieldsValue(
      b === 'new'
        ? { account_type: 'current', is_active: true }
        : { ...b, opened_on: b.opened_on ? dayjs(b.opened_on) : null, fdr_maturity_date: b.fdr_maturity_date ? dayjs(b.fdr_maturity_date) : null },
    )
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
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['funds'] })
      queryClient.invalidateQueries({ queryKey: ['account-options'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{tx('ব্যাংক হিসাব')}</h2>
        <Can perm="bank.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            {tx('নতুন ব্যাংক হিসাব')}
          </Button>
        </Can>
      </div>
      <Table<Bank>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: tx('কোড'), width: 80, render: (_, b) => digits(b.account.code) },
          {
            title: tx('ব্যাংক ও শাখা'),
            render: (_, b) => (
              <>
                <b>{b.bank_name}</b>
                {b.branch_name && <Typography.Text type="secondary"> · {b.branch_name}</Typography.Text>}
              </>
            ),
          },
          { title: tx('হিসাব নং'), dataIndex: 'account_no', render: digits },
          {
            title: tx('ধরন'),
            dataIndex: 'account_type',
            render: (t: string, b) => (
              <>
                {BANK_TYPE_LABEL[t] ?? t}
                {t === 'fdr' && b.fdr_maturity_date && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {tx('মেয়াদপূর্তি')}: {fmtDate(b.fdr_maturity_date)}
                  </Typography.Text>
                )}
              </>
            ),
          },
          { title: tx('জের (টাকা)'), dataIndex: 'balance', align: 'right', render: (v: number) => <b>{money(v)}</b> },
          { title: tx('অবস্থা'), dataIndex: 'is_active', render: (v) => (v ? <Tag color="green">{tx('সক্রিয়')}</Tag> : <Tag>{tx('নিষ্ক্রিয়')}</Tag>) },
          {
            title: '',
            width: 300,
            render: (_, b) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setStatement(b)}>
                  {tx('স্টেটমেন্ট')}
                </Button>
                {can('bank.create') && b.is_active && (
                  <>
                    <Button size="small" onClick={() => setTxn({ kind: 'transfer', fundId: b.account_id })}>
                      {tx('স্থানান্তর')}
                    </Button>
                    <Button size="small" onClick={() => setTxn({ kind: 'receipt', fundId: b.account_id })}>
                      {tx('জমা')}
                    </Button>
                  </>
                )}
                {can('bank.edit') && (
                  <Button size="small" onClick={() => open(b)}>
                    {tx('সম্পাদনা')}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      {data && data.length > 0 && (
        <Descriptions size="small" style={{ marginTop: 16 }}>
          <Descriptions.Item label={tx('মোট ব্যাংক জের')}>
            <b>{money(data.reduce((s, b) => s + Number(b.balance), 0))}</b>
          </Descriptions.Item>
        </Descriptions>
      )}

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
    </>
  )
}
