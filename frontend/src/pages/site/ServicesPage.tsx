import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowRightOutlined, CheckCircleFilled, FileTextOutlined, PhoneFilled } from '@ant-design/icons'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { pick } from '../../lib/website'
import { JoinBanner, ServiceCards } from './HomePage'
import { PageBanner, SERVICES, usePageTitle, useSite } from './kit'

/** Every service as a card; each opens its own page. */
export function ServicesPage() {
  const title = tx('আমাদের সেবা')
  usePageTitle(title)

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap">
          <span className="ld-kicker">{tx('আমরা যা করি')}</span>
          <h2 className="ld-page-title">{tx('কৃষক, সদস্য ও গ্রামের প্রতিটি পরিবারের জন্য')}</h2>
          <p className="ld-prose ld-lead">{tx('কৃষি ও আবাসিক ব্যবহারের জন্য সমন্বিত পানি ব্যবস্থাপনা সেবা, একটি টেকসই ও সমৃদ্ধ সমাজের জন্য।')}</p>
          <ServiceCards all />
        </div>
      </section>
      <JoinBanner />
    </>
  )
}

/** One service: what it is, how to get it, the papers needed — and for water, the tariff from the system. */
export function ServiceDetailPage() {
  const { key } = useParams()
  const { site, phone, telHref } = useSite()
  const service = SERVICES.find((s) => s.key === key)
  usePageTitle(service?.title ?? null)
  if (!service) return <Navigate to="/services" replace />

  const tariff = service.key === 'water' ? (site?.water_types ?? []).filter((w) => w.monthly_fee > 0 || w.connection_fee > 0) : []
  const others = SERVICES.filter((s) => s.key !== service.key)

  return (
    <>
      <PageBanner title={service.title} crumbs={[{ label: tx('আমাদের সেবা'), to: '/services' }]} />
      <section className="ld-page">
        <div className="ld-wrap ld-detail">
          <article className="ld-detail-main">
            <img className="ld-detail-photo" src={service.photo} alt="" />
            <p className="ld-prose ld-lead">{service.intro}</p>

            <h3 className="ld-sub">{tx('যা পাবেন')}</h3>
            <ul className="ld-ticks">
              {service.points.map((p) => (
                <li key={p}>
                  <CheckCircleFilled /> {p}
                </li>
              ))}
            </ul>

            {tariff.length > 0 && (
              <>
                <h3 className="ld-sub">{tx('সংযোগের ধরন ও ফি')}</h3>
                <div className="ld-table-wrap">
                  <table className="ld-table">
                    <thead>
                      <tr>
                        <th>{tx('সংযোগের ধরন')}</th>
                        <th>{tx('মাসিক বিল')}</th>
                        <th>{tx('সংযোগ ফি')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tariff.map((w) => (
                        <tr key={w.code}>
                          <td>{pick(w.name)}</td>
                          <td>৳ {money(w.monthly_fee)}</td>
                          <td>৳ {money(w.connection_fee)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3 className="ld-sub">{tx('কীভাবে নেবেন')}</h3>
            <ol className="ld-steps">
              {service.steps.map((s, i) => (
                <li key={s}>
                  <span>{digits(i + 1)}</span>
                  {s}
                </li>
              ))}
            </ol>

            <h3 className="ld-sub">{tx('যা লাগবে')}</h3>
            <ul className="ld-ticks ld-ticks-doc">
              {service.papers.map((p) => (
                <li key={p}>
                  <FileTextOutlined /> {p}
                </li>
              ))}
            </ul>
          </article>

          <aside className="ld-detail-side">
            <div className="ld-card ld-side-cta">
              <h3>{tx('এই সেবা নিতে চান?')}</h3>
              <p>{tx('অফিসে আসুন, ফোন করুন বা বার্তা পাঠান — আমরা সাহায্য করব।')}</p>
              <Link to={service.cta.to} className="ld-btn ld-btn-green">
                {service.cta.label} <ArrowRightOutlined />
              </Link>
              {phone && (
                <a href={telHref} className="ld-btn ld-btn-outline">
                  <PhoneFilled /> {digits(phone)}
                </a>
              )}
            </div>
            <div className="ld-card">
              <h3>{tx('অন্যান্য সেবা')}</h3>
              <ul className="ld-side-links">
                {others.map((s) => (
                  <li key={s.key}>
                    <Link to={`/services/${s.key}`}>
                      {s.title} <ArrowRightOutlined />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </>
  )
}
