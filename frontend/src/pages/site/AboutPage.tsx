import { UserOutlined } from '@ant-design/icons'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl } from '../../lib/website'
import { JoinBanner } from './HomePage'
import { asset, DiamondIcon, HandshakeIcon, PageBanner, StatsBand, TargetIcon, usePageTitle, useSite } from './kit'

/** Who the society is: the full introduction, aims, facts, the president's word and the committee. */
export default function AboutPage() {
  const { site, society } = useSite()
  const title = tx('আমাদের সম্পর্কে')
  usePageTitle(title)

  const workArea = pick(site?.work_area)
  const facts = [
    site?.founded_year && { label: tx('প্রতিষ্ঠা'), value: digits(site.founded_year) },
    site?.registration_no && { label: tx('নিবন্ধন নং'), value: digits(site.registration_no) },
    workArea && { label: tx('কর্ম এলাকা'), value: workArea },
  ].filter(Boolean) as { label: string; value: string }[]
  const president = site?.president
  const word = pick(president?.message)
  const committee = site?.committee ?? []
  const aims = [
    { icon: <TargetIcon />, title: tx('আমাদের লক্ষ্য'), text: pick(site?.vision) },
    { icon: <HandshakeIcon />, title: tx('আমাদের উদ্দেশ্য'), text: pick(site?.mission) },
    { icon: <DiamondIcon />, title: tx('আমাদের মূল্যবোধ'), text: pick(site?.values) },
  ].filter((a) => a.text)

  return (
    <>
      <PageBanner title={title} />

      <section className="ld-page">
        <div className="ld-wrap ld-about-page">
          <div>
            <span className="ld-kicker">{tx('পরিচিতি')}</span>
            <h2 className="ld-page-title">{pick(site?.about_title) || society}</h2>
            {pick(site?.intro) && <p className="ld-prose">{pick(site?.intro)}</p>}
            {facts.length > 0 && (
              <dl className="ld-facts-grid">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <img className="ld-about-photo" src={site?.about_photo ? sitePhotoUrl(site.about_photo) : asset('about.jpg')} alt={society} />
        </div>
      </section>

      {aims.length > 0 && (
        <section className="ld-page ld-page-tint">
          <div className="ld-wrap ld-aims">
            {aims.map((a) => (
              <div key={a.title} className="ld-card ld-aim">
                <span className="ld-aim-ic">{a.icon}</span>
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <StatsBand site={site} />

      {word && (
        <section className="ld-page">
          <div className="ld-wrap">
            <div className="ld-card ld-president">
              {president?.photo ? <img src={sitePhotoUrl(president.photo)} alt={pick(president.name)} /> : <span className="ld-president-ph"><UserOutlined /></span>}
              <div>
                <span className="ld-kicker">{tx('সভাপতির বাণী')}</span>
                <blockquote className="ld-prose">{word}</blockquote>
                {pick(president?.name) && (
                  <p className="ld-president-name">
                    <b>{pick(president?.name)}</b>
                    {pick(president?.role) && <small>{pick(president?.role)}</small>}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {committee.length > 0 && (
        <section className="ld-page ld-page-tint">
          <div className="ld-wrap">
            <span className="ld-kicker">{tx('পরিচালনা কমিটি')}</span>
            <h2 className="ld-page-title">{tx('যাঁরা সমিতি পরিচালনা করছেন')}</h2>
            <div className="ld-committee">
              {committee.map((c, i) => (
                <div className="ld-person" key={i}>
                  {c.photo ? (
                    <img className="ld-avatar" src={sitePhotoUrl(c.photo)} alt={pick(c.name)} />
                  ) : (
                    <span className="ld-avatar">
                      <UserOutlined />
                    </span>
                  )}
                  <b>{pick(c.name)}</b>
                  <small>{pick(c.role)}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <JoinBanner />
    </>
  )
}
