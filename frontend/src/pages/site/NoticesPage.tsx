import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Pagination } from 'antd'
import { ArrowLeftOutlined, CalendarOutlined, DownloadOutlined, FilePdfOutlined } from '@ant-design/icons'
import { digits } from '../../lib/format'
import { t as tx } from '../../lib/i18n'
import { pick, sitePhotoUrl } from '../../lib/website'
import { noticeDate, NoticeRow, PageBanner, tagTone, usePageTitle, useSite } from './kit'

const PER_PAGE = 10

/** All notices, newest first, with the tags to narrow them. */
export function NoticesPage() {
  const { site } = useSite()
  const title = tx('নোটিশ')
  usePageTitle(title)
  const [tag, setTag] = useState('')
  const [page, setPage] = useState(1)

  const notices = useMemo(() => site?.notices ?? [], [site])
  const tags = useMemo(() => Array.from(new Set(notices.map((n) => pick(n.tag)).filter(Boolean))), [notices])
  const shown = tag ? notices.filter((n) => pick(n.tag) === tag) : notices
  const rows = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <PageBanner title={title} />
      <section className="ld-page">
        <div className="ld-wrap ld-narrow">
          {tags.length > 1 && (
            <div className="ld-chips">
              <button type="button" className={!tag ? 'on' : ''} onClick={() => (setTag(''), setPage(1))}>
                {tx('সব')}
              </button>
              {tags.map((t) => (
                <button type="button" key={t} className={tag === t ? 'on' : ''} onClick={() => (setTag(t), setPage(1))}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {rows.length ? (
            <div className="ld-notices">
              {rows.map((n) => (
                <NoticeRow key={n.id} n={n} />
              ))}
            </div>
          ) : (
            <p className="ld-empty">{tx('এখনো কোনো নোটিশ নেই।')}</p>
          )}
          {shown.length > PER_PAGE && (
            <Pagination className="ld-pager" current={page} pageSize={PER_PAGE} total={shown.length} onChange={setPage} showSizeChanger={false} itemRender={(p, type, el) => (type === 'page' ? <a>{digits(p)}</a> : el)} />
          )}
        </div>
      </section>
    </>
  )
}

/** One notice: its date and tag, the full text and its attachment. */
export function NoticeDetailPage() {
  const { id } = useParams()
  const { site } = useSite()
  const notices = site?.notices ?? []
  const index = notices.findIndex((n) => n.id === id)
  const n = notices[index]
  usePageTitle(n ? pick(n.title) : null)
  if (!n) return <Navigate to="/notices" replace />

  const d = noticeDate(n.date)
  const tag = pick(n.tag)
  const body = pick(n.body)
  const isPdf = n.attachment?.endsWith('.pdf')
  const newer = notices[index - 1]
  const older = notices[index + 1]

  return (
    <>
      <PageBanner title={tx('নোটিশ')} crumbs={[]} />
      <section className="ld-page">
        <div className="ld-wrap ld-narrow">
          <article className="ld-card ld-notice-page">
            <p className="ld-notice-meta">
              <CalendarOutlined /> {d.day} {d.rest}
              {tag && <span className={`ld-tag ld-tag-${tagTone(tag)}`}>{tag}</span>}
            </p>
            <h2>{pick(n.title)}</h2>
            {body ? <div className="ld-prose">{body}</div> : null}
            {n.attachment &&
              (isPdf ? (
                <a className="ld-attach" href={sitePhotoUrl(n.attachment)} target="_blank" rel="noreferrer">
                  <FilePdfOutlined />
                  <span>
                    <b>{n.attachment_name || tx('সংযুক্ত ফাইল')}</b>
                    <small>{tx('PDF — খুলতে বা নামাতে চাপুন')}</small>
                  </span>
                  <DownloadOutlined />
                </a>
              ) : (
                <a href={sitePhotoUrl(n.attachment)} target="_blank" rel="noreferrer">
                  <img className="ld-notice-img" src={sitePhotoUrl(n.attachment)} alt={pick(n.title)} />
                </a>
              ))}
          </article>
          <div className="ld-prevnext">
            {newer ? (
              <Link to={`/notices/${newer.id}`}>
                <small>{tx('নতুন নোটিশ')}</small>
                {pick(newer.title)}
              </Link>
            ) : (
              <span />
            )}
            {older && (
              <Link to={`/notices/${older.id}`} className="ld-prevnext-r">
                <small>{tx('পুরোনো নোটিশ')}</small>
                {pick(older.title)}
              </Link>
            )}
          </div>
          <Link to="/notices" className="ld-more">
            <ArrowLeftOutlined /> {tx('সব নোটিশ')}
          </Link>
        </div>
      </section>
    </>
  )
}
