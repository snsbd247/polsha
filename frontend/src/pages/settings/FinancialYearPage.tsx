import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Col, Input, Modal, Row, Spin, Statistic, Table, Tag } from 'antd'
import { api, errorMessage } from '../../lib/api'
import { ACCOUNT_TYPE_LABEL, money } from '../../lib/accounting'
import { digits, fmtDate, fmtDateTime } from '../../lib/format'
import { nameOf, t as tx } from '../../lib/i18n'

type Year = {
  fiscal_year: string
  start_date: string
  end_date: string
  is_current: boolean
  close: {
    surplus: string
    closed_at: string
    note: string | null
    closer: { name_bn: string; name_en: string | null } | null
    journal: { id: number; voucher_no: string } | null
  } | null
}
type Preview = {
  fiscal_year: string
  start_date: string
  end_date: string
  income_total: number
  expense_total: number
  surplus: number
  accounts: { code: string; name_bn: string; name_en: string | null; type: string; amount: number }[]
  open_periods: number
  problems: string[]
  can_close: boolean
}

function CloseModal({ fy, onClose }: { fy: string | null; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({
    queryKey: ['fy-preview', fy],
    queryFn: async () => (await api.get<Preview>(`/financial-years/${fy}/preview`)).data,
    enabled: fy !== null,
  })
  const close = async () => {
    setBusy(true)
    try {
      await api.post(`/financial-years/${fy}/close`, { note: note || null, confirm: true })
      message.success(tx('অর্থবছর বন্ধ হয়েছে।'))
      queryClient.invalidateQueries({ queryKey: ['financial-years'] })
      onClose()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={fy !== null}
      width={760}
      title={tx('অর্থবছর {{fy}} বন্ধ', { fy: digits(fy ?? '') })}
      onCancel={onClose}
      destroyOnHidden
      okText={tx('বছর বন্ধ করুন')}
      okButtonProps={{ danger: true, disabled: !data?.can_close || !confirm, loading: busy }}
      onOk={close}
    >
      {!data ? (
        <Spin />
      ) : (
        <>
          <p style={{ color: '#888' }}>
            {fmtDate(data.start_date)} – {fmtDate(data.end_date)}
          </p>
          {data.problems.map((p) => (
            <Alert key={p} type="error" showIcon title={p} style={{ marginBottom: 8 }} />
          ))}
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={8}>
              <Statistic title={tx('মোট আয়')} value={money(data.income_total)} prefix="৳" />
            </Col>
            <Col span={8}>
              <Statistic title={tx('মোট ব্যয়')} value={money(data.expense_total)} prefix="৳" />
            </Col>
            <Col span={8}>
              <Statistic
                title={data.surplus >= 0 ? tx('উদ্বৃত্ত') : tx('ঘাটতি')}
                value={money(Math.abs(data.surplus))}
                prefix="৳"
                styles={{ content: { color: data.surplus >= 0 ? '#389e0d' : '#cf1322' } }}
              />
            </Col>
          </Row>
          <Table
            rowKey="code"
            size="small"
            dataSource={data.accounts}
            pagination={false}
            scroll={{ y: 260 }}
            columns={[
              { title: tx('কোড'), dataIndex: 'code', width: 90, render: digits },
              { title: tx('হিসাব'), render: (_, a) => nameOf(a) },
              { title: tx('ধরন'), dataIndex: 'type', width: 90, render: (v: string) => ACCOUNT_TYPE_LABEL[v] ?? v },
              { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
            ]}
          />
          <Alert
            type="warning"
            showIcon
            style={{ margin: '12px 0' }}
            title={tx('সব আয় ও ব্যয় হিসাব শূন্য করে নিট ফল "পুঞ্জীভূত উদ্বৃত্ত" হিসাবে যাবে এবং বছরের সব মাস স্থায়ীভাবে বন্ধ হবে। এটি ফেরানো যায় না।')}
          />
          <Input.TextArea rows={2} maxLength={500} placeholder={tx('মন্তব্য (যেমন: বার্ষিক সাধারণ সভার সিদ্ধান্ত নং)')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Checkbox style={{ marginTop: 8 }} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!data.can_close}>
            {tx('আমি নিশ্চিত, এই অর্থবছর বন্ধ করতে চাই')}
          </Checkbox>
        </>
      )}
    </Modal>
  )
}

/** Financial years with their status; closing sweeps income/expense into accumulated surplus. */
export default function FinancialYearPage() {
  const [closing, setClosing] = useState<string | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['financial-years'],
    queryFn: async () => (await api.get<Year[]>('/financial-years')).data,
  })

  return (
    <>
      <div className="page-header">
        <h2>{tx('অর্থবছর')}</h2>
      </div>
      <p style={{ color: '#888' }}>
        {tx('অর্থবছর শুরুর মাস সাধারণ সেটিংসে ঠিক করা হয়। মাসিক বন্ধের জন্য:')} <Link to="/accounting/periods">{tx('হিসাবকাল বন্ধ')}</Link>
      </p>
      <Table<Year>
        rowKey="fiscal_year"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        scroll={{ x: 800 }}
        columns={[
          {
            title: tx('অর্থবছর'),
            dataIndex: 'fiscal_year',
            render: (v: string, y) => (
              <>
                <b>{digits(v)}</b> {y.is_current && <Tag color="blue">{tx('চলতি')}</Tag>}
              </>
            ),
          },
          { title: tx('সময়কাল'), render: (_, y) => `${fmtDate(y.start_date)} – ${fmtDate(y.end_date)}` },
          { title: tx('অবস্থা'), render: (_, y) => (y.close ? <Tag color="green">{tx('বন্ধ')}</Tag> : <Tag>{tx('খোলা')}</Tag>) },
          { title: tx('উদ্বৃত্ত / (ঘাটতি)'), align: 'right', render: (_, y) => (y.close ? money(y.close.surplus) : '') },
          {
            title: tx('সমাপনী ভাউচার'),
            render: (_, y) => (y.close?.journal ? <Link to={`/accounting/journals/${y.close.journal.id}`}>{digits(y.close.journal.voucher_no)}</Link> : ''),
          },
          { title: tx('বন্ধ করেছেন'), render: (_, y) => (y.close ? `${nameOf(y.close.closer)} · ${fmtDateTime(y.close.closed_at)}` : '') },
          {
            title: '',
            render: (_, y) =>
              y.close ? null : (
                <Button size="small" onClick={() => setClosing(y.fiscal_year)}>
                  {tx('বন্ধের প্রিভিউ')}
                </Button>
              ),
          },
        ]}
      />
      <CloseModal fy={closing} onClose={() => setClosing(null)} />
    </>
  )
}
