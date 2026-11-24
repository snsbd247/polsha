import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, Modal, Spin } from 'antd'
import { EditFilled, PrinterOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import PageFrame from '../../components/PageFrame'
import { useAuth } from '../../auth/AuthContext'
import { api, applyFormErrors, errorMessage } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import '../cashbook/receipt-payment.css'

type G = { male: number; female: number; total: number }
type Glance = {
  date: string
  info: Record<string, string | null>
  labels: Record<string, string>
  society: { name: string | null; registration_no: string | null; registration_date: string | null; address: string | null }
  villages: number
  mouzas: number
  members: G
  new_members: G
  cancelled_members: G
  capital: { share: number; savings: number; total: number }
  capital_month: { share: number; savings: number; total: number }
  savings_withdrawal: { month: number; total: number }
  share_withdrawal_month: number
  dividend: { year: number; share: number; savings: number; total: number }
  banks: { bank: string; accounts: { account_no: string; type: string; balance: number }[] }[]
  loans: {
    disbursed_total: G
    borrowers_total: G
    collected_total: number
    disbursed_month: number
    borrowers_month: G
    collected_month: number
    collected_year: number
    outstanding: number
    service_charge_month: number
    service_charge_year: number
  }
}

const tk = (v: number) => `${digits(Math.round(v).toLocaleString('en-IN'))}/=`
const n = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '' : digits(String(v)))
const ACCOUNT_TYPES: Record<string, string> = { current: 'চলতি', savings: 'সঞ্চয়ী', fdr: 'এফডিআর' }

/** "এক নজরে" — the society at a glance, as the sheet it sends each month. */
export default function AtAGlancePage() {
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm()
  const { data: g, isFetching } = useQuery({
    queryKey: ['at-a-glance', date.format('YYYY-MM-DD')],
    queryFn: async () => (await api.get<Glance>('/reports-at-a-glance', { params: { date: date.format('YYYY-MM-DD') } })).data,
  })

  const save = async () => {
    const v = await form.validateFields()
    try {
      await api.put('/reports-at-a-glance/info', v)
      message.success(tx('সংরক্ষণ হয়েছে।'))
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['at-a-glance'] })
    } catch (e) {
      if (!applyFormErrors(form, e)) message.error(errorMessage(e))
    }
  }

  const i = g?.info ?? {}
  const mf = (x: G, unit = '') => [
    `${n(x.total)}${unit}`,
    `${tx('পুরুষঃ')} ${n(x.male)}`,
    `${tx('মহিলাঃ')} ${n(x.female)}`,
  ]
  const hand = (total: string | null, male: string | null, female: string | null) => {
    const m = Number(String(male ?? '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))) || 0)
    const f = Number(String(female ?? '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))) || 0)
    return [`${total ?? n(m + f)}${tx('টি')}`, `${tx('পুরুষঃ')} ${n(male)}`, `${tx('মহিলাঃ')} ${n(female)}`]
  }
  const rows: [string, ReactNode[]][] = g
    ? [
        [tx('উপ-প্রকল্পের নাম'), [i.project_name ?? '', i.sp_no ? `${tx('এসপি নং')}-${n(i.sp_no)}` : '']],
        [tx('পাবসস এর নাম'), [g.society.name ?? '', i.project_type ? `${tx('ধরণঃ')} ${i.project_type}` : '', i.upazila ? `${tx('উপজেলা')} : ${i.upazila}` : '']],
        [tx('নিবন্ধন নং ও তারিখ'), [`${n(g.society.registration_no)}${g.society.registration_date ? `, ${tx('তারিখ')}:${fmtDate(g.society.registration_date)}` : ''}`]],
        [tx('উপ-প্রকল্পের আয়তন'), [`${tx('মোট কমান্ডিং এলাকাঃ')} ${n(i.command_area)} ${tx('হেক্টর')}`, `${tx('উপকৃত এলাকাঃ')} ${n(i.benefit_area)} ${tx('হেক্টর')}`]],
        [tx('মোট পরিবার সংখ্যা'), hand(null, i.families_male, i.families_female)],
        [tx('উপকারভোগী পরিবার সংখ্যা'), hand(null, i.beneficiary_male, i.beneficiary_female)],
        [tx('ব্যবস্থাপনা কমিটি সদস্য সংখ্যা'), hand(null, i.committee_male, i.committee_female)],
        [tx('পানি ব্যবস্থাপনা গ্রুপ/ ব্লক'), [`${n(i.groups)}${tx('টি')}`, `${tx('গ্রামঃ')}${n(g.villages)}${tx('টা')}`, `${tx('মৌজাঃ')}${n(g.mouzas)}${tx('টা')}`]],
        [tx('পাবসস এর সদস্য সংখ্যা'), mf(g.members, ` ${tx('জন')}`)],
        [tx('প্রতিবেদনাধীন মাসে সদস্য সংখ্যা'), mf(g.new_members, ` ${tx('জন')}`)],
        [tx('পাবসস এর নিজস্ব মূলধন'), [tk(g.capital.total), `${tx('শেয়ার')}: ${tk(g.capital.share)}`, `${tx('সঞ্চয়')}: ${tk(g.capital.savings)}`]],
        [tx('প্রতিবেদনাধীন মাসে আদায়কৃত মূলধন'), [tk(g.capital_month.total), `${tx('শেয়ার')}: ${tk(g.capital_month.share)}`, `${tx('সঞ্চয়')}: ${tk(g.capital_month.savings)}`]],
        [tx('প্রতিবেদনাধীন মাসে সঞ্চয় উত্তোলন'), [tk(g.savings_withdrawal.month), `${tx('মোট সঞ্চয় উত্তোলন')}: ${tk(g.savings_withdrawal.total)}`]],
        [
          tx('প্রতিবেদনাধীন মাসে শেয়ার উত্তোলন'),
          [tk(g.share_withdrawal_month), `${tx('সদস্য বাতিল')}: ${n(g.cancelled_members.total)} ${tx('জন')}`, `${tx('পুঃ')} ${n(g.cancelled_members.male)}`, `${tx('মঃ')} ${n(g.cancelled_members.female)}`],
        ],
        [tx('প্রদত্ত লভ্যাংশ বন্টন'), [tk(g.dividend.year), `${tx('শেয়ার')}: ${tk(g.dividend.share)}`, `${tx('সঞ্চয়')}: ${tk(g.dividend.savings)}`, `${tx('মোট লভ্যাংশ বন্টন')}: ${tk(g.dividend.total)}`]],
        [tx('বার্ষিক সাধারণ সভা'), [i.agm_date ?? '']],
        [tx('অডিট সম্পাদনের তারিখ'), [i.audit_date ?? '']],
      ]
    : []
  const rows2: [string, ReactNode[]][] = g
    ? [
        [tx('প্রদত্ত ঘূর্ণায়মান ঋণ প্রদান'), [tk(g.loans.disbursed_total.total), `${tx('মোট')}: ${n(g.loans.borrowers_total.total)} ${tx('জন')}`, `${tx('পুরুষঃ')} ${n(g.loans.borrowers_total.male)} ${tx('জন')}`, `${tx('মহিলাঃ')} ${n(g.loans.borrowers_total.female)} ${tx('জন')}`]],
        [tx('প্রদত্ত ঘূর্ণায়মান ঋণ আদায়'), [tk(g.loans.collected_total)]],
        [tx('প্রতিবেদনাধীন মাসে ঋণ প্রদান'), [tk(g.loans.disbursed_month), `${tx('লোনিঃ')} ${n(g.loans.borrowers_month.total)} ${tx('জন')}`, `${tx('পুরুষঃ')} ${n(g.loans.borrowers_month.male)} ${tx('জন')}`, `${tx('মহিলাঃ')} ${n(g.loans.borrowers_month.female)} ${tx('জন')}`]],
        [tx('প্রতিবেদনাধীন মাসে ঋণ আদায়'), [tk(g.loans.collected_month), `${tx('মোট ঋণ আদায়')}: ${tk(g.loans.collected_year)}`]],
        [tx('ঋণ অনাদায়ী'), [tk(g.loans.outstanding)]],
        [tx('সার্ভিস চার্জ আদায়'), [tk(g.loans.service_charge_month), `${tx('মোট সার্ভিস চার্জ')}: ${tk(g.loans.service_charge_year)}`]],
        [tx('ব্যবস্থাপনা কমিটির সভা'), [i.committee_meetings ? `${n(i.committee_meetings)}${tx('টি')}` : '']],
        [tx('পাবসস এর প্রশিক্ষণ সমূহ'), [i.trainings ?? '']],
        [tx('পাবসস এর উপ-কমিটি সমূহ'), [i.sub_committees ?? '']],
        [tx('উপ-প্রকল্প হস্তান্তর তারিখ'), [i.handover_date ?? '', i.election_date ? `${tx('নির্বাচনঃ')} ${i.election_date}` : '']],
      ]
    : []
  const list = (r: [string, ReactNode[]][]) => (
    <ul className="ag-list">
      {r.map(([label, vals]) => (
        <li key={label}>
          <span>{label}</span>
          <span className="ag-v">
            :{' '}
            {vals.filter(Boolean).map((v, k) => (
              <span key={k}>{v}</span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <PageFrame className="rp-page" crumbs={[{ label: tx('রিপোর্ট'), to: '/reports/collections' }, { label: tx('এক নজরে') }]} title={tx('এক নজরে')}>
      <div className="rp-bar no-print">
        <label>
          {tx('তথ্য প্রদানের তারিখ')}
          <DatePicker value={date} format="DD/MM/YYYY" allowClear={false} onChange={(d) => d && setDate(d)} />
        </label>
        <span className="rp-hint">{tx('মাসের হিসাবগুলো এই তারিখের মাস ধরে; "মোট" হিসাব অর্থবছর বা শুরু থেকে।')}</span>
        {can('settings.admin') && (
          <Button
            icon={<EditFilled />}
            onClick={() => {
              form.setFieldsValue(i)
              setEditing(true)
            }}
          >
            {tx('হাতে লেখা তথ্য')}
          </Button>
        )}
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!g}>
          {tx('প্রিন্ট / PDF')}
        </Button>
      </div>
      {!g ? (
        <Spin />
      ) : (
        <div className={`rp-sheet${isFetching ? ' rp-busy' : ''}`}>
          <h2 className="ag-title">{tx('এক নজরে {{p0}}', { p0: g.society.name ?? '' })}</h2>
          <div className="ag-date">
            {tx('তথ্য প্রদানের তারিখ')}: {fmtDate(g.date)}
          </div>
          {list(rows)}
          {g.banks.length > 0 && (
            <table className="ag-banks">
              <thead>
                <tr>
                  {g.banks.map((b) => (
                    <th key={b.bank}>{b.bank}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {g.banks.map((b) => (
                    <td key={b.bank}>
                      {b.accounts.map((a, k) => (
                        <div key={a.account_no}>
                          {digits(String(k + 1).padStart(2, '0'))}। {tx(ACCOUNT_TYPES[a.type] ?? a.type)} ({digits(a.account_no)})- {tx('স্থিতি')}={tk(a.balance)}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          {list(rows2)}
          <div className="rp-signs">
            {[tx('হিসাবরক্ষক'), tx('ক্যাশিয়ার'), tx('সম্পাদক'), tx('সভাপতি')].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        </div>
      )}
      <Modal open={editing} forceRender width={720} title={tx('এক নজরে — হাতে লেখা তথ্য')} onCancel={() => setEditing(false)} onOk={save} okText={tx('সংরক্ষণ')} cancelText={tx('বাতিল')}>
        <Form form={form} layout="vertical" className="ag-form">
          {Object.entries(g?.labels ?? {}).map(([key, label]) => (
            <Form.Item key={key} name={key} label={label}>
              {['trainings', 'sub_committees'].includes(key) ? <Input.TextArea rows={2} maxLength={1000} /> : <Input maxLength={200} />}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </PageFrame>
  )
}
