import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from 'antd'
import {
  ArrowRightOutlined,
  CreditCardFilled,
  CustomerServiceFilled,
  FileSearchOutlined,
  HomeFilled,
  LeftOutlined,
  QrcodeOutlined,
  QuestionCircleFilled,
  RightOutlined,
  SoundFilled,
  ThunderboltFilled,
} from '@ant-design/icons'
import { t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl } from '../../lib/website'
import { asset, BarsIcon, DiamondIcon, HandshakeIcon, HeroTitle, LeafIcon, NoticeRow, PeopleIcon, PlantHandIcon, SERVICES, StatsBand, TargetIcon, usePageTitle, useSite } from './kit'

const DEFAULT_SLIDES = [asset('hero.jpg'), asset('slide2.jpg'), asset('cta.jpg')]

/** The home page: the slider and quick services, then a short look at every other page. */
export default function HomePage() {
  const { site, society } = useSite()
  const [slide, setSlide] = useState(0)
  const [verifyOpen, setVerifyOpen] = useState(false)
  usePageTitle(null)

  const slides = site?.hero_photos?.length ? site.hero_photos.map(sitePhotoUrl) : DEFAULT_SLIDES
  useEffect(() => {
    if (slides.length < 2) return
    const id = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 6000)
    return () => window.clearInterval(id)
  }, [slides.length, slide])

  const notices = site?.notices ?? []
  const faqs = site?.faqs ?? []
  const quick = [
    { tone: 'red', icon: <CreditCardFilled />, title: tx('অনলাইনে বিল দিন'), text: tx('সেচ, পানি ও ঋণের কিস্তি বিকাশ/নগদে পরিশোধ করুন'), to: '/pay' },
    { tone: 'blue', icon: <FileSearchOutlined />, title: tx('পেমেন্টের অবস্থা দেখুন'), text: tx('অনুরোধ নম্বর ও মোবাইল নম্বর দিয়ে পেমেন্টের অবস্থা দেখুন'), to: '/pay?tab=status' },
    { tone: 'green', icon: <QrcodeOutlined />, title: tx('রশিদ যাচাই করুন'), text: tx('রশিদের QR কোড ফোনের ক্যামেরায় স্ক্যান করুন'), onClick: () => setVerifyOpen(true) },
    { tone: 'purple', icon: <CustomerServiceFilled />, title: tx('সেবার অনুরোধ'), text: tx('সেবার অনুরোধ বা অভিযোগ জানান'), to: '/contact?subject=service' },
  ]

  return (
    <>
      {/* hero */}
      <section className="ld-hero">
        {slides.map((src, i) => (
          <div key={src} className={`ld-slide${i === slide ? ' on' : ''}`} style={{ backgroundImage: `url("${src}")` } as CSSProperties} />
        ))}
        <div className="ld-hero-shade" />
        <div className="ld-wrap ld-hero-in">
          <div className="ld-hero-text">
            {pick(site?.hero_kicker) && <span className="ld-kicker ld-kicker-light">{pick(site?.hero_kicker)}</span>}
            <HeroTitle text={pick(site?.hero_title) || society} />
            {pick(site?.tagline) && <p>{pick(site?.tagline)}</p>}
            <div className="ld-hero-btns">
              <Link to="/services" className="ld-btn ld-btn-green">
                {tx('আমাদের সেবা')} <ArrowRightOutlined />
              </Link>
              <Link to="/about" className="ld-btn ld-btn-white">
                {tx('আরও জানুন')} <ArrowRightOutlined />
              </Link>
            </div>
          </div>
          <div className="ld-hero-cards">
            {[
              { icon: <LeafIcon />, tone: 'green', label: tx('সেচ সেবা'), to: '/services/irrigation' },
              { icon: <HomeFilled />, tone: 'blue', label: tx('আবাসিক পানি সরবরাহ'), to: '/services/water' },
              { icon: <PeopleIcon />, tone: 'green', label: tx('সদস্য সেবা'), to: '/services/savings' },
              { icon: <BarsIcon />, tone: 'multi', label: tx('স্বচ্ছ ব্যবস্থাপনা'), to: '/about' },
            ].map((c) => (
              <Link key={c.label} to={c.to} className="ld-hero-card">
                <span className={`ld-hc-ic ld-hc-${c.tone}`}>{c.icon}</span>
                <span>{c.label}</span>
              </Link>
            ))}
          </div>
        </div>
        {slides.length > 1 && (
          <>
            <button type="button" className="ld-arrow ld-arrow-l" aria-label={tx('আগের ছবি')} onClick={() => setSlide((slide + slides.length - 1) % slides.length)}>
              <LeftOutlined />
            </button>
            <button type="button" className="ld-arrow ld-arrow-r" aria-label={tx('পরের ছবি')} onClick={() => setSlide((slide + 1) % slides.length)}>
              <RightOutlined />
            </button>
            <div className="ld-dots">
              {slides.map((src, i) => (
                <button type="button" key={src} className={i === slide ? 'on' : ''} aria-label={`${i + 1}`} onClick={() => setSlide(i)} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* quick services */}
      <section className="ld-quick">
        <div className="ld-wrap">
          <div className="ld-quick-head">
            <span className="ld-quick-bolt">
              <ThunderboltFilled />
            </span>
            <div>
              <h2>{tx('দ্রুত সেবা')}</h2>
              <p>{tx('গুরুত্বপূর্ণ সেবা দ্রুত ও সহজে নিন')}</p>
            </div>
          </div>
          <div className="ld-quick-grid">
            {quick.map((q) => {
              const inner = (
                <>
                  <span className="ld-q-ic">{q.icon}</span>
                  <span className="ld-q-body">
                    <b>{q.title}</b>
                    <small>{q.text}</small>
                  </span>
                  <span className="ld-q-go">
                    <ArrowRightOutlined />
                  </span>
                </>
              )
              return q.to ? (
                <Link key={q.title} to={q.to} className={`ld-q ld-q-${q.tone}`}>
                  {inner}
                </Link>
              ) : (
                <button type="button" key={q.title} className={`ld-q ld-q-${q.tone}`} onClick={q.onClick}>
                  {inner}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <StatsBand site={site} />

      {/* about, in short */}
      <section className="ld-about">
        <div className="ld-wrap ld-about-in">
          <div className="ld-about-text">
            <span className="ld-kicker">{tx('আমাদের সম্পর্কে')}</span>
            <h2>{pick(site?.about_title) || society}</h2>
            {pick(site?.intro) && <p className="ld-clamp">{pick(site?.intro)}</p>}
            <Link to="/about" className="ld-btn ld-btn-green">
              {tx('আরও পড়ুন')} <ArrowRightOutlined />
            </Link>
          </div>
          <div className="ld-about-media">
            <img src={site?.about_photo ? sitePhotoUrl(site.about_photo) : asset('about.jpg')} alt={society} />
            <div className="ld-vmv">
              {[
                { icon: <TargetIcon />, title: tx('আমাদের লক্ষ্য'), text: pick(site?.vision) },
                { icon: <HandshakeIcon />, title: tx('আমাদের উদ্দেশ্য'), text: pick(site?.mission) },
                { icon: <DiamondIcon />, title: tx('আমাদের মূল্যবোধ'), text: pick(site?.values) },
              ]
                .filter((v) => v.text)
                .map((v) => (
                  <div key={v.title} className="ld-vmv-row">
                    <span className="ld-vmv-ic">{v.icon}</span>
                    <span>
                      <b>{v.title}</b>
                      <small>{v.text}</small>
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>

      {/* services, in short */}
      <section className="ld-services">
        <div className="ld-wrap">
          <div className="ld-services-head">
            <div>
              <span className="ld-kicker">{tx('আমাদের সেবা')}</span>
              <h2>{tx('আমরা যা করি')}</h2>
              <p>{tx('কৃষি ও আবাসিক ব্যবহারের জন্য সমন্বিত পানি ব্যবস্থাপনা সেবা, একটি টেকসই ও সমৃদ্ধ সমাজের জন্য।')}</p>
            </div>
            <Link to="/services" className="ld-btn ld-btn-outline">
              {tx('সব সেবা দেখুন')} <ArrowRightOutlined />
            </Link>
          </div>
          <ServiceCards />
        </div>
      </section>

      {/* latest notices + a few questions */}
      {(notices.length > 0 || faqs.length > 0) && (
        <section className="ld-nf">
          <div className={`ld-wrap ld-nf-in${notices.length && faqs.length ? '' : ' ld-nf-solo'}`}>
            {notices.length > 0 && (
              <div>
                <div className="ld-nf-head">
                  <h2>
                    <SoundFilled className="ld-nf-ic ld-nf-mega" /> {tx('সাম্প্রতিক নোটিশ')}
                  </h2>
                  <Link to="/notices" className="ld-more">
                    {tx('সব দেখুন')} <ArrowRightOutlined />
                  </Link>
                </div>
                <div className="ld-notices">
                  {notices.slice(0, 4).map((n) => (
                    <NoticeRow key={n.id} n={n} />
                  ))}
                </div>
              </div>
            )}
            {faqs.length > 0 && (
              <div>
                <div className="ld-nf-head">
                  <h2>
                    <QuestionCircleFilled className="ld-nf-ic" /> {tx('সচরাচর জিজ্ঞাসা')}
                  </h2>
                  <Link to="/faq" className="ld-more">
                    {tx('সব দেখুন')} <ArrowRightOutlined />
                  </Link>
                </div>
                <div className="ld-faqs">
                  {faqs.slice(0, 5).map((f, i) => (
                    <Link key={i} to={`/faq#q${i + 1}`} className="ld-faq ld-faq-link">
                      <span>{pick(f.q)}</span>
                      <RightOutlined />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <JoinBanner />

      <Modal open={verifyOpen} title={tx('রশিদ যাচাই করুন')} footer={null} onCancel={() => setVerifyOpen(false)} destroyOnHidden>
        <p className="ld-info-text">{tx('প্রতিটি রশিদে একটি QR কোড আছে। ফোনের ক্যামেরা দিয়ে কোডটি স্ক্যান করলে সমিতির খাতায় থাকা রশিদটি খুলবে — টাকার পরিমাণ ও তারিখ মিলিয়ে দেখুন।')}</p>
      </Modal>
    </>
  )
}

/** The four main services as photo cards (home page and the services page). */
export function ServiceCards({ all = false }: { all?: boolean }) {
  return (
    <div className="ld-svc-grid">
      {(all ? SERVICES : SERVICES.slice(0, 4)).map((s) => (
        <Link key={s.key} to={`/services/${s.key}`} className={`ld-svc ld-svc-${s.key}`}>
          <img src={s.photo} alt="" loading="lazy" />
          <div className="ld-svc-body">
            <span className="ld-svc-ic">{s.icon}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <span className="ld-more">
              {tx('আরও জানুন')} <ArrowRightOutlined />
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

/** "Join us" band above the footer. */
export function JoinBanner() {
  return (
    <section className="ld-cta" style={{ backgroundImage: `url("${asset('cta.jpg')}")` }}>
      <div className="ld-wrap ld-cta-in">
        <span className="ld-cta-ic">
          <PlantHandIcon />
        </span>
        <div>
          <h2>{tx('আসুন, পানি-নিরাপদ ও সমৃদ্ধ সমাজ একসাথে গড়ি')}</h2>
          <p>{tx('টেকসই পানি ব্যবস্থাপনায় আমাদের সাথে যুক্ত হোন, একটি সুন্দর আগামীর জন্য।')}</p>
        </div>
        <Link to="/contact?subject=membership" className="ld-btn ld-btn-green">
          {tx('সদস্য হোন')} <ArrowRightOutlined />
        </Link>
      </div>
    </section>
  )
}
