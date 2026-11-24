import { Link, Navigate, useParams } from 'react-router-dom'
import {
  ArrowLeftOutlined,
  BookOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
  IdcardOutlined,
  MailOutlined,
  PhoneOutlined,
  SolutionOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl, type SitePerson } from '../../lib/website'
import { noticeDate, PageBanner, usePageTitle, useSite } from './kit'

/** "জুলাই ২০২৪ – জুন ২০২৭"; one end alone reads "from …" / "until …". */
function termText(p: SitePerson): string {
  const from = p.term_from ? noticeDate(p.term_from).rest : ''
  const to = p.term_to ? noticeDate(p.term_to).rest : ''
  if (from && to) return `${from} – ${to}`
  if (from) return tx('{{p0}} থেকে', { p0: from })
  if (to) return tx('{{p0}} পর্যন্ত', { p0: to })
  return ''
}

function Avatar({ p, big }: { p: SitePerson; big?: boolean }) {
  const cls = big ? 'ld-profile-photo' : 'ld-avatar'
  return p.photo ? (
    <img className={cls} src={sitePhotoUrl(p.photo)} alt={pick(p.name)} />
  ) : (
    <span className={cls}>
      <UserOutlined />
    </span>
  )
}

/** The committee as cards; each card opens the person's profile. */
export function CommitteeGrid({ people }: { people: SitePerson[] }) {
  return (
    <div className="ld-committee">
      {people.map((c, i) => (
        <Link className="ld-person ld-person-link" key={c.id ?? i} to={`/committee/${c.id}`}>
          <Avatar p={c} />
          <b>{pick(c.name)}</b>
          <small>{pick(c.role)}</small>
          <span className="ld-person-more">{tx('প্রোফাইল দেখুন')}</span>
        </Link>
      ))}
    </div>
  )
}

/** All of the current managing committee. */
export function CommitteePage() {
  const { site } = useSite()
  const title = tx('পরিচালনা কমিটি')
  usePageTitle(title)
  const people = site?.committee ?? []
  const term = people.map(termText).find(Boolean)

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap">
          <h2 className="ld-page-title">{tx('যাঁরা সমিতি পরিচালনা করছেন')}</h2>
          {term && (
            <p className="ld-committee-term">
              <CalendarOutlined /> {tx('মেয়াদ: {{p0}}', { p0: term })}
            </p>
          )}
          {people.length ? <CommitteeGrid people={people} /> : <p className="ld-empty">{tx('কমিটির তথ্য এখনো দেওয়া হয়নি।')}</p>}
        </div>
      </section>
    </>
  )
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li>
      <span className="ld-fact-ic">{icon}</span>
      <span>
        <small>{label}</small>
        <b>{children}</b>
      </span>
    </li>
  )
}

/** One committee member's own page. */
export function CommitteeProfilePage() {
  const { id } = useParams()
  const { site } = useSite()
  const people = site?.committee ?? []
  const index = people.findIndex((p) => p.id === id)
  const p = people[index]
  usePageTitle(p ? pick(p.name) : null)
  if (!site) return null
  if (!p) return <Navigate to="/committee" replace />

  const term = termText(p)
  const bio = pick(p.bio)
  const message = pick(p.message)
  const duties = pick(p.responsibilities)
  const prev = people[index - 1]
  const next = people[index + 1]
  const facts = [
    term && <Fact key="term" icon={<CalendarOutlined />} label={tx('মেয়াদ')}>{term}</Fact>,
    p.member_no && <Fact key="no" icon={<IdcardOutlined />} label={tx('সদস্য নং')}>{digits(p.member_no)}</Fact>,
    pick(p.village) && <Fact key="village" icon={<EnvironmentOutlined />} label={tx('গ্রাম/ঠিকানা')}>{pick(p.village)}</Fact>,
    pick(p.occupation) && <Fact key="job" icon={<SolutionOutlined />} label={tx('পেশা')}>{pick(p.occupation)}</Fact>,
    pick(p.education) && <Fact key="edu" icon={<BookOutlined />} label={tx('শিক্ষাগত যোগ্যতা')}>{pick(p.education)}</Fact>,
    p.phone && (
      <Fact key="phone" icon={<PhoneOutlined />} label={tx('মোবাইল')}>
        <a href={`tel:${p.phone}`}>{digits(p.phone)}</a>
      </Fact>
    ),
    p.email && (
      <Fact key="email" icon={<MailOutlined />} label={tx('ইমেইল')}>
        <a href={`mailto:${p.email}`}>{p.email}</a>
      </Fact>
    ),
  ].filter(Boolean)

  return (
    <>
      <PageBanner title={pick(p.name)} crumbs={[{ label: tx('পরিচালনা কমিটি'), to: '/committee' }]} />
      <section className="ld-page">
        <div className="ld-wrap ld-narrow">
          <article className="ld-card ld-profile">
            <header className="ld-profile-head">
              <Avatar p={p} big />
              <div>
                <h2>{pick(p.name)}</h2>
                <span className="ld-profile-role">{pick(p.role)}</span>
                {term && <small className="ld-profile-term">{tx('মেয়াদ: {{p0}}', { p0: term })}</small>}
              </div>
            </header>

            {facts.length > 0 && <ul className="ld-facts">{facts}</ul>}

            {message && <blockquote className="ld-profile-quote ld-prose">{message}</blockquote>}

            {bio && (
              <section className="ld-profile-sec">
                <h3>{tx('পরিচিতি')}</h3>
                <div className="ld-prose">{bio}</div>
              </section>
            )}

            {duties && (
              <section className="ld-profile-sec">
                <h3>{tx('দায়িত্ব ও উপ-কমিটি')}</h3>
                <div className="ld-prose">{duties}</div>
              </section>
            )}
          </article>

          <div className="ld-prevnext">
            {prev ? (
              <Link to={`/committee/${prev.id}`}>
                <small>{tx('আগের সদস্য')}</small>
                {pick(prev.name)}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/committee/${next.id}`} className="ld-prevnext-r">
                <small>{tx('পরের সদস্য')}</small>
                {pick(next.name)}
              </Link>
            )}
          </div>
          <Link to="/committee" className="ld-more">
            <ArrowLeftOutlined /> {tx('পুরো কমিটি')}
          </Link>
        </div>
      </section>
    </>
  )
}
