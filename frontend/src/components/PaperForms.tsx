import type { ReactNode } from 'react'
import { digits, fmtDate } from '../lib/format'
import { amountInWords } from '../lib/irrigation'
import { logoUrl, type Society } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import ProtectedImage from './ProtectedImage'
import './paper-slip.css'

/**
 * The society's printed A4 forms, filled in from the records: membership
 * application, loan application, loan undertaking (অঙ্গীকার নামা) and the
 * share/savings withdrawal application. Laid out like the society's own
 * paper; anything not on record leaves its dotted line for handwriting.
 */

type Soc = Society & { registration_date?: string | null }

const acre = (decimal: number | string | null | undefined) => (decimal === null || decimal === undefined || decimal === '' ? '' : digits((Number(decimal) / 100).toFixed(2)))
const taka = (v: number | string | null | undefined) => (Number(v) ? digits(Math.round(Number(v)).toLocaleString('en-IN')) : '')

/** An inline dotted blank, filled when the value is known. */
function D({ v, w }: { v?: ReactNode; w?: number }) {
  return (
    <span className="pf-dot" style={w ? { minWidth: w } : undefined}>
      {v}
    </span>
  )
}

/** "a/b/c" with the chosen one marked, as the paper asks the applicant to strike out the rest. */
function Choice({ options, chosen }: { options: string[]; chosen?: string | null }) {
  return (
    <span className="pf-choice">
      {options.map((o, i) => (
        <span key={o}>
          {i > 0 && '/'}
          <span className={chosen && o === chosen ? 'pf-chosen' : ''}>{o}</span>
        </span>
      ))}
    </span>
  )
}

function Head({ society, title, photo, sub }: { society: Soc; title?: string; photo?: string | null | false; sub?: ReactNode }) {
  return (
    <>
      <div className="pf-head">
        {society.logo && <img className="ps-logo" src={logoUrl()} alt="" />}
        <div className="ps-brand">
          <div className="ps-name">{nameOf(society)}</div>
          {society.address && <div className="pf-line">{tx('ঠিকানা')} : {society.address}</div>}
          {(society.registration_no || society.registration_date) && (
            <div className="pf-line">
              {tx('নিবন্ধন নং')} {digits(society.registration_no ?? '')}
              {society.registration_date && `, ${tx('নিবন্ধনের তারিখ')} : ${fmtDate(society.registration_date)}${tx('ইং')}`}
            </div>
          )}
          {sub}
        </div>
        {photo !== false && <div className="pf-photo">{photo ? <ProtectedImage url={photo} size={110} /> : tx('ছবি')}</div>}
      </div>
      {title && (
        <div className="ps-title">
          <span>{title}</span>
        </div>
      )}
    </>
  )
}

function Signs({ rows }: { rows: { label: ReactNode; name?: ReactNode }[][] }) {
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="pf-signs">
          {row.map((s, k) => (
            <div key={k}>
              {s.name && <b>{s.name}</b>}
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- membership

export type MembershipPaper = {
  society: Soc
  application_no: string
  applied_on: string
  photo_url: string | null
  farmer_address: string | null
  farmer: {
    name_bn: string
    father_name: string
    mother_name?: string | null
    spouse_name?: string | null
    marital_status?: string | null
    date_of_birth?: string | null
    occupation?: string | null
    secondary_occupation?: string | null
  }
  nominees: { name: string; relation: string | null }[]
  proposer?: { member_no: number; farmer: { name_bn: string } | null } | null
  wetland_own_decimal?: string | number | null
  wetland_used_decimal?: string | number | null
  annual_income?: string | number | null
  paper: { own: number; tenancy: number; own_served: number; tenancy_served: number } | null
}

const MARITAL: Record<string, string> = { married: 'বিবাহিত', unmarried: 'অবিবাহিত', divorced: 'তালাক প্রাপ্ত', widowed: 'বিধবা' }

export function MembershipApplicationPaper({ a, occupations }: { a: MembershipPaper; occupations?: Record<string, string> }) {
  const f = a.farmer
  // age on the day of application, as the form is filled then
  const age = f.date_of_birth ? Math.floor((new Date(a.applied_on).getTime() - new Date(f.date_of_birth).getTime()) / (365.25 * 86400000)) : null
  const land = a.paper ?? { own: 0, tenancy: 0, own_served: 0, tenancy_served: 0 }
  const nominee = a.nominees.map((n) => `${n.name}${n.relation ? ` (${n.relation})` : ''}`).join(', ')
  return (
    <div className="pf-sheet">
      <Head society={a.society} title={tx('সদস্যপদের আবেদন পত্র')} photo={a.photo_url} />
      <p className="pf-p">
        {tx('আমি নিম্নস্বাক্ষরকারী উপ-প্রকল্পের একজন সুফলভোগী/বাসিন্দা হিসাবে পাবসস-এর সদস্য হতে আগ্রহী। ব্যবস্থাপনা কমিটির বিবেচনার জন্য আমার ব্যক্তিগত ও জমি সংক্রান্ত তথ্যাদি নিম্নে দেয়া হলো এবং সদস্য পদ লাভের পর আমি যাবতীয় দায়িত্ব ও কর্তব্য পালনের অঙ্গীকার করছি।')}
      </p>
      <h4 className="pf-part">{tx('প্রথম অংশ')}</h4>
      <div className="pf-grid2">
        <div>
          <div className="pf-row">{digits(1)}। {tx('আবেদনকারীর নাম')} : <D v={f.name_bn} /></div>
          <div className="pf-row">{digits(2)}। {tx('পিতার নাম')} : <D v={f.father_name} /></div>
          <div className="pf-row">{digits(3)}। {tx('মাতার নাম')} : <D v={f.mother_name} /></div>
          <div className="pf-row">{digits(4)}। {tx('স্বামী/স্ত্রীর নাম')} : <D v={f.spouse_name} /></div>
          <div className="pf-row">
            {digits(5)}। {tx('বৈবাহিক অবস্থা')} : <Choice options={['বিবাহিত', 'অবিবাহিত', 'তালাক প্রাপ্ত', 'বিধবা']} chosen={f.marital_status ? MARITAL[f.marital_status] : null} />
          </div>
        </div>
        <div>
          <div className="pf-row">{digits(6)}। {tx('প্রার্থীর বয়স')} : <D v={age !== null ? `${digits(age)} ${tx('বছর')}` : ''} /></div>
          <div className="pf-row">{digits(7)}। {tx('গ্রাম/মহল্লা/বাড়ী')} : <D v={a.farmer_address} /></div>
          <div className="pf-row">{digits(8)}। {tx('পেশা')} : ({tx('ক')}) {tx('প্রধান')} <D v={f.occupation ? (occupations?.[f.occupation] ?? f.occupation) : ''} w={90} /></div>
          <div className="pf-row pf-indent">({tx('খ')}) {tx('অপ্রধান')} <D v={f.secondary_occupation} w={90} /></div>
        </div>
      </div>
      <h4 className="pf-part">{tx('দ্বিতীয় অংশ')}</h4>
      <table className="pf-land">
        <tbody>
          <tr>
            <td rowSpan={3}>({digits(1)}) {tx('নিজ মালিকানা এবং চাষের আওতায় কৃষি জমি')}</td>
            <td>({tx('ক')}) {tx('নিজের মালিকানায় মোট জমি (একরে)')}</td>
            <td className="pf-v">{acre(land.own)}</td>
          </tr>
          <tr>
            <td>({tx('খ')}) {tx('বর্গা/বন্ধকের আওতায় চাষের অধীন জমি')}</td>
            <td className="pf-v">{acre(land.tenancy)}</td>
          </tr>
          <tr className="pf-total">
            <td>{tx('মোট চাষের অধীন জমি')}</td>
            <td className="pf-v">{acre(land.own + land.tenancy)}</td>
          </tr>
          <tr>
            <td rowSpan={3}>({digits(2)}) {tx('উপ-প্রকল্পের মাধ্যমে উপকৃত কৃষি জমি')}</td>
            <td>({tx('ক')}) {tx('নিজের মোট জমি (একরে)')}</td>
            <td className="pf-v">{acre(land.own_served)}</td>
          </tr>
          <tr>
            <td>({tx('খ')}) {tx('বর্গা/বন্ধকী জমি')}</td>
            <td className="pf-v">{acre(land.tenancy_served)}</td>
          </tr>
          <tr className="pf-total">
            <td>{tx('উপকৃত মোট জমি')}</td>
            <td className="pf-v">{acre(land.own_served + land.tenancy_served)}</td>
          </tr>
        </tbody>
      </table>
      <div className="pf-row">({digits(3)}) {tx('আবেদনকারীর নিজের মালিকানায় মোট জলাভূমির পরিমাণ (একরে)')}- <D v={acre(a.wetland_own_decimal)} w={80} /></div>
      <div className="pf-row">({digits(4)}) {tx('আবেদনকারীর ব্যবহারের আওতায় খাস/অন্যের মালিকানাধীন জলাভূমির পরিমাণ')}- <D v={acre(a.wetland_used_decimal)} w={80} /></div>
      <div className="pf-row">({digits(5)}) {tx('আবেদনকারীর পরিবারের আনুমানিক বাৎসরিক আয় (টাকায়)')}- <D v={taka(a.annual_income)} w={80} /></div>
      <div className="pf-row">({digits(6)}) {tx('আবেদনকারীর নমিনীর নাম ও সম্পর্ক')}- <D v={nominee} /></div>
      <h4 className="pf-part">{tx('তৃতীয় অংশ')}</h4>
      <p className="pf-p">{tx('আমি এই মর্মে অঙ্গীকার করছি যে, সমবায় আইন, বিধি ও সমিতির উপ-আইন অনুসারে একজন সদস্য হিসাবে সকল দায়-দায়িত্ব পালনে সচেষ্ট থাকব। বিশেষতঃ নিম্নে বর্ণিত দায়িত্ব সমূহ পালনে বিশেষভাবে যত্নবান হবো।')}</p>
      <ol className="pf-ol">
        <li>{tx('সমিতির সভা সমূহে নিয়মিত যোগদান করব।')}</li>
        <li>{tx('সমিতির সাথে শেয়ার-সঞ্চয়সহ অন্যান্য সকল আর্থিক লেনদেন নিয়মিতভাবে রক্ষা করব।')}</li>
        <li>{tx('উপ-প্রকল্পের পরিকল্পনা, বাস্তবায়ন, পরিচালনা ও রক্ষণাবেক্ষণ কাজে যথা নিয়মে অংশ গ্রহণ করবো।')}</li>
        <li>{tx('সমিতির মাধ্যমে নিজের এবং এলাকার আর্থ-সামাজিক উন্নয়নের যথাসাধ্য অবদান রাখব।')}</li>
        <li>{tx('সমিতির সংখ্যা গরিষ্ঠের মতামতের প্রতি শ্রদ্ধাশীল এবং সংখ্যা লঘিষ্ঠের মতামতের প্রতি সহানুভূতিশীল প্রদর্শন করবো।')}</li>
      </ol>
      <Signs
        rows={[
          [
            { label: tx('পরিচয়দানকারীর নাম ও স্বাক্ষর, সদস্য নম্বর'), name: a.proposer ? `${a.proposer.farmer?.name_bn ?? ''} (${digits(a.proposer.member_no)})` : undefined },
            { label: tx('নমীনির নাম ও স্বাক্ষর'), name: a.nominees[0]?.name },
            { label: tx('আবেদনকারীর নাম ও স্বাক্ষর'), name: f.name_bn },
          ],
          [{ label: tx('হিসাব রক্ষকের সীল ও স্বাক্ষর') }, { label: tx('সম্পাদকের সীল ও স্বাক্ষর') }, { label: tx('সভাপতির সীল ও স্বাক্ষর') }],
        ]}
      />
      <div className="pf-foot">
        {tx('আবেদন নং')}: {digits(a.application_no)} · {tx('আবেদনের তারিখ')}: {fmtDate(a.applied_on)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- loans

type Person = { name: string | null; father_name: string | null; mobile: string | null; village: string | null; post_office: string | null; upazila: string | null; district: string | null; photo_url?: string | null; member_no?: string | number | null }
export type LoanPaper = {
  society: Soc
  loan_no: string
  applied_on: string
  disbursed_on: string | null
  amount: number | string
  purpose: string | null
  interest_rate: number | string
  frequency: string
  status: string
  member_no: number | string | null
  borrower: Person | null
  guarantors: Person[]
  family_guarantor: (Partial<Person> & { relation?: string | null }) | null
  last_due: string | null
}

const PURPOSES = ['পারিবারিক', 'ব্যবসা', 'মৎস্য', 'পশু পালন', 'রিক্সা', 'কৃষি']
/** Seasonal / one-off loans are "মৌসুম ভিত্তিক" on the paper; the rest "মাসিক". */
const loanKind = (frequency: string) => (['seasonal', 'one_time', 'quarterly'].includes(frequency) ? 'মৌসুম ভিত্তিক' : 'মাসিক')
const sanctioned = (status: string) => ['approved', 'active', 'closed'].includes(status)

function PersonBlock({ p, memberNo }: { p: Partial<Person> | null; memberNo?: ReactNode }) {
  return (
    <div className="pf-person">
      <div className="pf-row">{tx('নাম')} : <D v={p?.name} /></div>
      <div className="pf-row">{tx('পিতা/স্বামীর নাম')} : <D v={p?.father_name} /></div>
      <div className="pf-row">{tx('ঠিকানা')} : {tx('গ্রাম')} <D v={p?.village} /></div>
      <div className="pf-row pf-indent">{tx('পোষ্ট')} : <D v={p?.post_office} /></div>
      <div className="pf-row pf-indent">{tx('উপজেলা')} : <D v={p?.upazila} /></div>
      <div className="pf-row pf-indent">{tx('জেলা')} : <D v={p?.district} /></div>
      <div className="pf-row">{tx('মোবাইল')} : <D v={p?.mobile ? digits(p.mobile) : ''} /></div>
      <div className="pf-row">{tx('সদস্য নং')} : <D v={memberNo} /></div>
    </div>
  )
}

export function LoanApplicationPaper({ l }: { l: LoanPaper }) {
  const b = l.borrower
  const ok = sanctioned(l.status)
  const purpose = PURPOSES.find((p) => l.purpose?.includes(p)) ?? null
  return (
    <div className="pf-sheet">
      <Head society={l.society} photo={b?.photo_url} sub={<div className="pf-line pf-strong">{tx('বার্ষিক মুনাফা-{{p0}}%', { p0: digits(Number(l.interest_rate)) })}</div>} />
      <div className="pf-to">
        {tx('বরাবর')},
        <br />
        <b>{tx('সভাপতি')},</b>
        <br />
        {nameOf(l.society)}
      </div>
      <div className="pf-subject">
        <span>
          {tx('বিষয়')} : <u>{tx('ঋণ পাইবার জন্য আবেদন')}</u>।
        </span>
        <span>
          {tx('আবেদনের তারিখ')} : <D v={fmtDate(l.applied_on)} />
        </span>
      </div>
      <p className="pf-p">{tx('জনাব,')}</p>
      <p className="pf-p pf-body">
        {tx('সবিনয় নিবেদন এই যে, আমি মোঃ/মোসাঃ')} <D v={b?.name} w={180} /> {tx('পিতা/স্বামী')} <D v={b?.father_name} w={160} /> {tx('গ্রাম')} <D v={b?.village} w={120} /> {tx('পোষ্ট')} <D v={b?.post_office} w={110} /> {tx('উপজেলা')} <D v={b?.upazila} w={110} /> {tx('জেলা')} <D v={b?.district} w={110} /> {tx('অত্র সমিতির একজন সদস্য/সদস্যা এবং আমার সদস্য নং')} <D v={l.member_no ? digits(String(l.member_no)) : ''} w={80} />। {tx('আমার')} <Choice options={['পারিবারিক', 'ব্যবসা', 'মৎস্য', 'পশু পালন', 'রিক্সা', 'কৃষি']} chosen={purpose} /> {tx('কাজের জন্য অত্র সমিতি হইতে')} <D v={taka(l.amount)} w={110} />) {tx('টাকা (কথায়')} <D v={amountInWords(Number(l.amount))} w={260} />) {tx('টাকা মাত্র ঋণ পাইবার জন্য আবেদন জানাইতেছি।')}
      </p>
      {l.purpose && !purpose && <div className="pf-row">{tx('উদ্দেশ্য')} : <D v={l.purpose} /></div>}
      <p className="pf-p pf-indent">{tx('অতএব, জনাব অনুগ্রহ পূর্বক উক্ত টাকা ঋণ হিসাবে প্রদান করিতে আপনার সদয় মর্জি হয়।')}</p>
      <div className="pf-right">
        <b>{tx('বিনীত নিবেদক-')}</b>
        <div className="pf-row">{tx('স্বাক্ষর/টিপসহি')}</div>
        <PersonBlock p={b} memberNo={l.member_no ? digits(String(l.member_no)) : ''} />
      </div>
      <p className="pf-p pf-body">
        {tx('আবেদনকারীর আবেদনের প্রেক্ষিতে')} <D v={ok ? taka(l.amount) : ''} w={110} /> ({tx('কথায়')} <D v={ok ? amountInWords(Number(l.amount)) : ''} w={240} />) {tx('টাকা ঋণ হিসাবে মঞ্জুর করার জন্য সুপারিশ করা হইলো। ঋণ পরিশোধের শেষ তারিখ')} <D v={ok && l.last_due ? fmtDate(l.last_due) : ''} w={100} />{tx('ইং')}।
      </p>
      <div className="pf-kind">
        <div>
          {tx('ঋণের ধরন')} : <span className={loanKind(l.frequency) === 'মৌসুম ভিত্তিক' ? 'pf-chosen' : ''}>({tx('ক')}) {tx('মৌসুম ভিত্তিক')}</span>
          <br />
          <span className="pf-indent2 ">
            <span className={loanKind(l.frequency) === 'মাসিক' ? 'pf-chosen' : ''}>({tx('খ')}) {tx('মাসিক টাকা')}</span>
          </span>
        </div>
        <div className="pf-convener">
          <span className="pf-sigline">{tx('স্বাক্ষর')}</span>
          <b>{tx('আহ্বায়ক')}</b>
          <span>{tx('ঋণ উপ-কমিটি')}</span>
          <span>{nameOf(l.society)}</span>
          <span>{tx('তাং-')}</span>
        </div>
      </div>
      <p className="pf-p pf-body">
        {tx('ঋণ উপ-কমিটির সুপারিশের প্রেক্ষিতে আবেদনকারীর অনুকূলে')} <D v={ok ? taka(l.amount) : ''} w={110} /> ({tx('কথায়')} <D v={ok ? amountInWords(Number(l.amount)) : ''} w={240} />) {tx('টাকা ঋণ মঞ্জুর করা হইলো।')}
      </p>
      <Signs rows={[[{ label: <>{tx('সম্পাদক')}<br />{nameOf(l.society)}<br />{tx('তাং-')}</> }, { label: <>{tx('সভাপতি')}<br />{nameOf(l.society)}<br />{tx('তাং-')}</> }]]} />
      <div className="pf-foot">{tx('ঋণ নং')}: {digits(l.loan_no)}</div>
    </div>
  )
}

export function LoanUndertakingPaper({ l }: { l: LoanPaper }) {
  const b = l.borrower
  const fg = l.family_guarantor
  const g = l.guarantors[0] ?? null
  return (
    <div className="pf-sheet">
      <Head society={l.society} title={tx('অঙ্গীকার নামা')} photo={false} />
      <p className="pf-p pf-body">
        {tx('আমি এই মর্মে অঙ্গীকার করিতেছি যে, তারিখ')} <D v={fmtDate(l.disbursed_on ?? l.applied_on)} w={100} /> {nameOf(l.society)} {tx('হইতে ঋণ হিসাবে')} <D v={taka(l.amount)} w={110} /> ({tx('কথায়')} <D v={amountInWords(Number(l.amount))} w={240} />) {tx('টাকা গ্রহণ করিলাম। তাহা সমিতির নিয়মানুযায়ী')} <Choice options={['মৌসুম ভিত্তিক', 'মাসিক']} chosen={loanKind(l.frequency)} /> {tx('ফেরৎ দিতে বাধ্য থাকিব। যদি কোন কারণে উহা ফেরৎ দিতে অসমর্থ হই তাহলে সমিতি আমার বিরুদ্ধে যে কোন আইনানুগ ব্যবস্থা গ্রহণ করিতে পারিবে।')}
      </p>
      <p className="pf-p pf-indent">{tx('আমি সজ্ঞানে ও স্বেচ্ছায় এই অঙ্গীকার পত্রে স্বাক্ষর করিলাম।')}</p>
      <div className="pf-right">
        <b>{tx('বিনীত নিবেদক-')}</b>
        <div className="pf-row">{tx('স্বাক্ষর/টিপসহি')}</div>
        <PersonBlock p={b} memberNo={l.member_no ? digits(String(l.member_no)) : ''} />
      </div>
      <p className="pf-p pf-indent">{tx('উক্ত ব্যক্তি ঋণ পরিশোধে ব্যর্থ হইলে সম্পূর্ণ ঋণের টাকা আমরা পরিশোধ করিতে বাধ্য থাকিব।')}</p>
      <div className="pf-grid2">
        <div>
          <h4 className="pf-part pf-left">{tx('পারিবারিক জামিনদারের স্বাক্ষর')}</h4>
          <div className="pf-row">{tx('স্বাক্ষর/টিপসহি')}</div>
          <PersonBlock p={fg ? { ...fg, name: fg.name ? `${fg.name}${fg.relation ? ` (${fg.relation})` : ''}` : null } : null} memberNo={fg?.member_no ? digits(String(fg.member_no)) : ''} />
        </div>
        <div>
          <h4 className="pf-part pf-left">{tx('সাধারণ সদস্যের স্বাক্ষর')}</h4>
          <div className="pf-row">{tx('স্বাক্ষর/টিপসহি')}</div>
          <PersonBlock p={g} memberNo={g?.member_no ? digits(String(g.member_no)) : ''} />
        </div>
      </div>
      <div className="pf-convener pf-center">
        <span className="pf-sigline">{tx('স্বাক্ষর')}</span>
        <b>{tx('আহ্বায়ক')}</b>
        <span>{tx('ঋণ উপ-কমিটি')}</span>
        <span>{nameOf(l.society)}</span>
        <span>{tx('তারিখ')} :</span>
      </div>
      <Signs rows={[[{ label: <>{tx('সম্পাদক')}<br />{nameOf(l.society)}<br />{tx('তাং-')}</> }, { label: <>{tx('সভাপতি')}<br />{nameOf(l.society)}<br />{tx('তাং-')}</> }]]} />
      <div className="pf-foot">{tx('ঋণ নং')}: {digits(l.loan_no)}</div>
    </div>
  )
}

// ---------------------------------------------------------------- withdrawal

export function WithdrawalApplicationPaper({ society, kind, date, amount, balanceAfter, name, father, address, memberNo }: {
  society: Soc
  kind: 'savings' | 'share'
  date: string
  amount: number
  balanceAfter: number | null
  name: string
  father?: string | null
  address?: string | null
  memberNo?: string | number | null
}) {
  const after = balanceAfter ?? null
  const before = after === null ? null : after + amount
  const full = after !== null && Math.abs(after) < 0.005
  const what = kind === 'share' ? 'শেয়ার' : 'সঞ্চয়'
  return (
    <div className="pf-sheet">
      <div className="pf-head">
        {society.logo && <img className="ps-logo" src={logoUrl()} alt="" />}
        <div className="pf-to">
          {tx('বরাবর')},
          <br />
          {tx('সভাপতি/সম্পাদক')}
          <br />
          <b className="pf-big">{nameOf(society)}</b>
        </div>
      </div>
      <div className="pf-date">
        {tx('তারিখ')} : <D v={fmtDate(date)} w={120} />
      </div>
      <div className="pf-subject pf-strong">
        <span>
          {tx('বিষয়')} : <u>
            <Choice options={['আংশিক', 'সম্পূর্ণ']} chosen={after === null ? null : full ? 'সম্পূর্ণ' : 'আংশিক'} /> <Choice options={['শেয়ার', 'সঞ্চয়']} chosen={what} /> {tx('উত্তোলন প্রসঙ্গে আবেদন')}
          </u>
          ।
        </span>
      </div>
      <p className="pf-p">
        <b>{tx('জনাব,')}</b>
      </p>
      <p className="pf-p pf-body">{tx('যথাবিহীত সম্মান প্রদর্শন পূর্বক বিনীত নিবেদন এই যে, আমি আপনার {{p0}} এর একজন সদস্য/সদস্যা। আমি আমার শেয়ার/সঞ্চয় উত্তোলন করতে ইচ্ছুক।', { p0: nameOf(society) })}</p>
      <p className="pf-p pf-body">{tx('অতএব বিধায় প্রার্থনা এই যে, অনুগ্রহ পূর্বক আমাকে আমার নিম্নলিখিত শেয়ার/সঞ্চয় ফেরত দিতে আপনার মর্জি হয়।')}</p>
      <table className="pf-sum">
        <tbody>
          <tr>
            <th>{tx('মোট শেয়ার/সঞ্চয়')}</th>
            <td>= {before !== null ? taka(before) : ''}</td>
          </tr>
          <tr className="pf-sum-line">
            <th>{tx('মোট উত্তোলন')}</th>
            <td>= {taka(amount)}</td>
          </tr>
          <tr>
            <th>{tx('স্থিতি')}</th>
            <td>= {after !== null ? taka(after) || digits('0') : ''}</td>
          </tr>
        </tbody>
      </table>
      <div className="pf-right">
        <div className="pf-center">{tx('বিনীত')}</div>
        <div className="pf-row">{tx('স্বাক্ষর')} : <D /></div>
        <div className="pf-row">{tx('আবেদনকারীর নাম')} : <D v={name} /></div>
        <div className="pf-row">{tx('পিতা/স্বামী')} : <D v={father} /></div>
        <div className="pf-row">{tx('ঠিকানা')} : <D v={address} /></div>
        <div className="pf-row">
          {tx('সদস্য কোড')} : <span className="pf-box">{memberNo ? digits(String(memberNo)) : ''}</span>
        </div>
      </div>
      <Signs rows={[[{ label: tx('হিসাব রক্ষক') }, { label: tx('সম্পাদক') }, { label: tx('সভাপতি') }]]} />
    </div>
  )
}
