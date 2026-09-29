import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, DatePicker, Grid, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BankFilled, BookOutlined, DollarCircleFilled, MinusCircleOutlined, PlusCircleOutlined, SwapOutlined, WalletFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAuth } from '../../auth/AuthContext'
import FundTxnModal, { type FundTxnKind } from '../../components/FundTxnModal'
import { BANK_TYPE_LABEL, accountLabel, money, useFunds, type Fund } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import ListFrame, { Field, n0 } from '../lands/ListFrame'
import '../lands/land-list.css'
import '../farmers/farmer-merge-list.css'
import '../lands/land-history.css'
import '../irrigation/invoices.css'
import '../loans/loans.css'
import '../cash/cash.css'

type Kind = '' | 'cash' | 'bank'

/** Cash in hand and at the bank on a day: each fund's opening, today's in and out, and closing balance. */
export default function FundsPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const wide = Grid.useBreakpoint().lg
  const [draft, setDraft] = useState<{ date: Dayjs; kind: Kind }>({ date: dayjs(), kind: '' })
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [kind, setKind] = useState<Kind>('')
  const [txn, setTxn] = useState<{ kind: FundTxnKind; fundId?: number } | null>(null)
  const ymd = date.format('YYYY-MM-DD')
  const { data, isFetching } = useFunds(ymd)

  const canMove = can(['cash.create', 'bank.create'])
  const all = data ?? []
  const rows = kind ? all.filter((f) => f.kind === kind) : all
  const sum = (list: Fund[], k: 'opening' | 'receipts' | 'payments' | 'closing' = 'closing') => list.reduce((s, f) => s + Number(f[k]), 0)
  const cash = all.filter((f) => f.kind === 'cash')
  const bank = all.filter((f) => f.kind === 'bank')
  const ledgerLink = (f: Fund) => `/accounting/ledger?account_id=${f.id}&from=${ymd}&to=${ymd}`
  const show = (k: Kind) => {
    setKind(k)
    setDraft((d) => ({ ...d, kind: k }))
  }

  const cards = [
    { key: 'cash', label: tx('মোট নগদ · {{p0}}টি খাত', { p0: n0(cash.length) }), value: data ? `৳ ${money(sum(cash))}` : undefined, icon: '', glyph: <WalletFilled />, color: '#1f9d55', tint: '#dcf3e5', onClick: () => show('cash') },
    { key: 'bank', label: tx('মোট ব্যাংক · {{p0}}টি হিসাব', { p0: n0(bank.length) }), value: data ? `৳ ${money(sum(bank))}` : undefined, icon: '', glyph: <BankFilled />, color: '#1769e0', tint: '#e4edfd', onClick: () => show('bank') },
    { key: 'all', label: tx('সর্বমোট তহবিল'), value: data ? `৳ ${money(sum(all))}` : undefined, icon: '', glyph: <DollarCircleFilled />, color: '#8b3fe0', tint: '#efe4fc', onClick: () => show('') },
    { key: 'net', label: tx('দিনের জমা − খরচ'), value: data ? `৳ ${money(sum(all, 'receipts') - sum(all, 'payments'))}` : undefined, icon: '', glyph: <SwapOutlined />, color: '#f08c00', tint: '#fdefd6' },
  ]

  const columns: ColumnsType<Fund> = [
    { title: '#', width: 44, align: 'center', render: (_, __, i) => digits(i + 1) },
    {
      title: tx('হিসাব'),
      render: (_, f) => (
        <span className="hs-two">
          <Link to={ledgerLink(f)} className="mg-name">
            {accountLabel(f)}
          </Link>
          {f.bank ? (
            <span>
              {f.bank.bank_name} · {digits(f.bank.account_no)}
            </span>
          ) : (
            <span>{digits(f.code)}</span>
          )}
        </span>
      ),
    },
    {
      title: tx('ধরন'),
      render: (_, f) =>
        f.bank ? (
          <>
            <Tag className="fl-tag ll-blue">{BANK_TYPE_LABEL[f.bank.account_type] ?? f.bank.account_type}</Tag>
            {!f.bank.is_active && <Tag className="fl-tag ll-gray">{tx('নিষ্ক্রিয়')}</Tag>}
          </>
        ) : (
          <Tag className="fl-tag fl-tag-green">{tx('নগদ')}</Tag>
        ),
    },
    { title: tx('প্রারম্ভিক জের (৳)'), dataIndex: 'opening', align: 'right', render: money },
    { title: tx('দিনের জমা (৳)'), dataIndex: 'receipts', align: 'right', render: (v: number) => <span className={Number(v) ? 'cs-in' : undefined}>{money(v)}</span> },
    { title: tx('দিনের খরচ (৳)'), dataIndex: 'payments', align: 'right', render: (v: number) => <span className={Number(v) ? 'cs-out' : undefined}>{money(v)}</span> },
    { title: tx('সমাপনী জের (৳)'), dataIndex: 'closing', align: 'right', render: (v: number) => <strong>{money(v)}</strong> },
    {
      title: tx('অ্যাকশন'),
      width: 170,
      align: 'center',
      fixed: wide ? 'right' : undefined,
      render: (_, f) => (
        <div className="fl-actions pl-actions">
          <Button className="fl-act pl-act" icon={<BookOutlined />} aria-label={tx('ক্যাশ বই')} title={tx('ক্যাশ বই')} onClick={() => navigate(ledgerLink(f))} />
          {can(f.kind === 'bank' ? 'bank.create' : 'cash.create') && (!f.bank || f.bank.is_active) && (
            <>
              <Button className="fl-act pl-act" icon={<PlusCircleOutlined />} aria-label={tx('জমা')} title={tx('জমা')} onClick={() => setTxn({ kind: 'receipt', fundId: f.id })} />
              <Button className="fl-act pl-act" icon={<MinusCircleOutlined />} aria-label={tx('খরচ')} title={tx('খরচ')} onClick={() => setTxn({ kind: 'payment', fundId: f.id })} />
              <Button className="fl-act pl-act" icon={<SwapOutlined />} aria-label={tx('স্থানান্তর')} title={tx('স্থানান্তর')} onClick={() => setTxn({ kind: 'transfer', fundId: f.id })} />
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <ListFrame
      section={{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }}
      title={tx('হাতে নগদ')}
      subtitle=""
      actions={
        canMove && (
          <>
            <Button icon={<PlusCircleOutlined />} onClick={() => setTxn({ kind: 'receipt' })}>
              {tx('জমা')}
            </Button>
            <Button icon={<MinusCircleOutlined />} onClick={() => setTxn({ kind: 'payment' })}>
              {tx('খরচ')}
            </Button>
            <Button type="primary" icon={<SwapOutlined />} onClick={() => setTxn({ kind: 'transfer' })}>
              {tx('স্থানান্তর')}
            </Button>
          </>
        )
      }
      cards={cards}
      filterClass="iv-filters"
      filters={
        <>
          <Field label={tx('তারিখ')}>
            <DatePicker format="DD-MM-YYYY" allowClear={false} value={draft.date} onChange={(d) => d && setDraft((x) => ({ ...x, date: d }))} disabledDate={(d) => d.isAfter(dayjs(), 'day')} style={{ width: '100%', height: 36 }} />
          </Field>
          <Field label={tx('ধরন')}>
            <Select
              value={draft.kind}
              options={[
                { value: '', label: tx('সকল') },
                { value: 'cash', label: tx('নগদ') },
                { value: 'bank', label: tx('ব্যাংক') },
              ]}
              onChange={(v) => setDraft((x) => ({ ...x, kind: v }))}
            />
          </Field>
        </>
      }
      onSearch={() => {
        setDate(draft.date)
        setKind(draft.kind)
      }}
      onReset={() => {
        setDraft({ date: dayjs(), kind: '' })
        setDate(dayjs())
        setKind('')
      }}
      tableTitle={tx('{{p0}} — {{p1}}', { p0: tx('তহবিলের অবস্থান'), p1: fmtDate(ymd) })}
    >
      <Table<Fund>
        className="fl-table ml-table pl-table mg-table iv-table"
        rowKey="id"
        loading={isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={columns}
        locale={{ emptyText: tx('কোনো তহবিল নেই') }}
        summary={() =>
          rows.length > 1 ? (
            <Table.Summary.Row className="ln-sum-row">
              <Table.Summary.Cell index={0} colSpan={3}>
                {tx('মোট')}
              </Table.Summary.Cell>
              {(['opening', 'receipts', 'payments', 'closing'] as const).map((k, i) => (
                <Table.Summary.Cell key={k} index={i + 3} align="right">
                  {money(sum(rows, k))}
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          ) : null
        }
      />
      <FundTxnModal kind={txn?.kind ?? null} fundId={txn?.fundId} onClose={() => setTxn(null)} />
    </ListFrame>
  )
}
