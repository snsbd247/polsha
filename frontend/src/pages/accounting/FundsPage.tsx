import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Col, DatePicker, Row, Space, Statistic, Table, Tag } from 'antd'
import { MinusCircleOutlined, PlusCircleOutlined, SwapOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundTxnModal, { type FundTxnKind } from '../../components/FundTxnModal'
import { BANK_TYPE_LABEL, accountLabel, money, useFunds, type Fund } from '../../lib/accounting'
import { t as tx } from '../../lib/i18n'

export default function FundsPage() {
  const { can } = useAuth()
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [txn, setTxn] = useState<{ kind: FundTxnKind; fundId?: number } | null>(null)
  const ymd = date.format('YYYY-MM-DD')
  const { data, isFetching } = useFunds(ymd)

  const canMove = can(['cash.create', 'bank.create'])
  const cash = (data ?? []).filter((f) => f.kind === 'cash')
  const bank = (data ?? []).filter((f) => f.kind === 'bank')
  const sum = (list: Fund[]) => list.reduce((s, f) => s + Number(f.closing), 0)
  const ledgerLink = (f: Fund) => `/accounting/ledger?account_id=${f.id}&from=${ymd}&to=${ymd}`

  const columns = [
    {
      title: tx('হিসাব'),
      render: (_: unknown, f: Fund) => (
        <Space size={4} wrap>
          <Link to={ledgerLink(f)}>{accountLabel(f)}</Link>
          {f.bank && <Tag>{BANK_TYPE_LABEL[f.bank.account_type] ?? f.bank.account_type}</Tag>}
          {f.bank && !f.bank.is_active && <Tag color="red">{tx('নিষ্ক্রিয়')}</Tag>}
        </Space>
      ),
    },
    { title: tx('প্রারম্ভিক জের'), dataIndex: 'opening', width: 140, align: 'right' as const, render: money },
    { title: tx('আজকের জমা'), dataIndex: 'receipts', width: 140, align: 'right' as const, render: money },
    { title: tx('আজকের খরচ'), dataIndex: 'payments', width: 140, align: 'right' as const, render: money },
    { title: tx('সমাপনী জের'), dataIndex: 'closing', width: 150, align: 'right' as const, render: (v: number) => <b>{money(v)}</b> },
    {
      title: '',
      width: 120,
      render: (_: unknown, f: Fund) =>
        can(f.kind === 'bank' ? 'bank.create' : 'cash.create') && (!f.bank || f.bank.is_active) ? (
          <Space size={0}>
            <Button type="text" icon={<PlusCircleOutlined style={{ color: '#389e0d' }} />} title={tx('জমা')} aria-label={tx('জমা')} onClick={() => setTxn({ kind: 'receipt', fundId: f.id })} />
            <Button type="text" icon={<MinusCircleOutlined style={{ color: '#cf1322' }} />} title={tx('খরচ')} aria-label={tx('খরচ')} onClick={() => setTxn({ kind: 'payment', fundId: f.id })} />
            <Button type="text" icon={<SwapOutlined />} title={tx('স্থানান্তর')} aria-label={tx('স্থানান্তর')} onClick={() => setTxn({ kind: 'transfer', fundId: f.id })} />
          </Space>
        ) : null,
    },
  ]

  const table = (list: Fund[], title: string) => (
    <Card title={title} size="small" style={{ marginBottom: 16 }}>
      <Table<Fund>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={list}
        pagination={false}
        scroll={{ x: 820 }}
        columns={columns}
        summary={() =>
          list.length > 1 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <b>{tx('মোট')}</b>
              </Table.Summary.Cell>
              {(['opening', 'receipts', 'payments', 'closing'] as const).map((k, i) => (
                <Table.Summary.Cell key={k} index={i + 1} align="right">
                  <b>{money(list.reduce((s, f) => s + Number(f[k]), 0))}</b>
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={5} />
            </Table.Summary.Row>
          ) : null
        }
      />
    </Card>
  )

  return (
    <>
      <div className="page-header">
        <h2>{tx('নগদ ও ব্যাংক অবস্থান')}</h2>
        <Space wrap>
          <DatePicker value={date} format="DD/MM/YYYY" allowClear={false} onChange={(d) => d && setDate(d)} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          {canMove && (
            <>
              <Button icon={<PlusCircleOutlined />} onClick={() => setTxn({ kind: 'receipt' })}>
                {tx('জমা')}
              </Button>
              <Button icon={<MinusCircleOutlined />} onClick={() => setTxn({ kind: 'payment' })}>
                {tx('খরচ')}
              </Button>
              <Button icon={<SwapOutlined />} onClick={() => setTxn({ kind: 'transfer' })}>
                {tx('স্থানান্তর')}
              </Button>
            </>
          )}
        </Space>
      </div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('মোট নগদ')} value={money(sum(cash))} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('মোট ব্যাংক')} value={money(sum(bank))} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title={tx('সর্বমোট তহবিল')} value={money(sum(cash) + sum(bank))} />
          </Card>
        </Col>
      </Row>
      {table(cash, tx('নগদ তহবিল (খাত অনুযায়ী আলাদা)'))}
      {table(bank, tx('ব্যাংক হিসাব'))}
      <FundTxnModal kind={txn?.kind ?? null} fundId={txn?.fundId} onClose={() => setTxn(null)} />
    </>
  )
}
