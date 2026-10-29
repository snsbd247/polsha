import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Image, Input } from 'antd'
import { MinusOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl } from '../../lib/website'
import { JoinBanner } from './HomePage'
import { PageBanner, usePageTitle, useSite } from './kit'

/** The society's photos; a click opens them large. */
export function GalleryPage() {
  const { site } = useSite()
  const title = tx('গ্যালারি')
  usePageTitle(title)
  const gallery = site?.gallery ?? []

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap">
          <span className="ld-kicker">{tx('আমাদের কার্যক্রম')}</span>
          <h2 className="ld-page-title">{tx('ছবিতে আমাদের কাজ')}</h2>
          {gallery.length ? (
            <Image.PreviewGroup>
              <div className="ld-gallery">
                {gallery.map((g, i) => (
                  <figure key={i}>
                    <Image src={sitePhotoUrl(g.photo)} alt={pick(g.caption)} loading="lazy" />
                    {pick(g.caption) && <figcaption>{pick(g.caption)}</figcaption>}
                  </figure>
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            <p className="ld-empty">{tx('শীঘ্রই ছবি যোগ করা হবে।')}</p>
          )}
        </div>
      </section>
    </>
  )
}

/** Every question, with a search box; /faq#q3 opens the third. */
export function FaqPage() {
  const { site } = useSite()
  const { hash } = useLocation()
  const title = tx('প্রশ্নোত্তর')
  usePageTitle(title)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  // arriving from the home page's list: open that question and bring it into view
  useEffect(() => {
    const m = /^#q(\d+)$/.exec(hash)
    if (!m) return
    const i = Number(m[1]) - 1
    setOpen(i)
    window.setTimeout(() => document.getElementById(`q${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }, [hash])

  const faqs = (site?.faqs ?? []).map((f, i) => ({ ...f, i }))
  const q = query.trim().toLowerCase()
  const shown = q ? faqs.filter((f) => `${pick(f.q)} ${pick(f.a)}`.toLowerCase().includes(q)) : faqs

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap ld-narrow">
          <span className="ld-kicker">{tx('সচরাচর জিজ্ঞাসা')}</span>
          <h2 className="ld-page-title">{tx('আপনার প্রশ্নের উত্তর')}</h2>
          <Input size="large" allowClear prefix={<SearchOutlined />} placeholder={tx('প্রশ্ন খুঁজুন…')} value={query} onChange={(e) => setQuery(e.target.value)} className="ld-faq-search" />
          {shown.length ? (
            <div className="ld-faqs ld-faqs-page">
              {shown.map((f) => (
                <div key={f.i} id={`q${f.i + 1}`} className={`ld-faq${open === f.i || q ? ' open' : ''}`}>
                  <button type="button" onClick={() => setOpen(open === f.i ? null : f.i)} aria-expanded={open === f.i}>
                    <span>{pick(f.q)}</span>
                    {open === f.i || q ? <MinusOutlined /> : <PlusOutlined />}
                  </button>
                  {(open === f.i || q) && <p>{pick(f.a)}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="ld-empty">{tx('কোনো প্রশ্ন মেলেনি। নিচে যোগাযোগ পাতায় সরাসরি জিজ্ঞাসা করুন।')}</p>
          )}
        </div>
      </section>
      <JoinBanner />
    </>
  )
}
