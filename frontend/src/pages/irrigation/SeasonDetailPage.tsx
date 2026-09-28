import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Spin, Tag } from 'antd'
import { ArrowLeftOutlined, CalendarFilled, EditOutlined, FileTextFilled, LinkOutlined, MinusCircleFilled, TagFilled } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import PageFrame from '../../components/PageFrame'
import { api } from '../../lib/api'
import { money } from '../../lib/accounting'
import { fmtDate, fmtDateTime } from '../../lib/format'
import type { Season } from '../../lib/irrigation'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import { acres, n0 } from '../lands/ListFrame'
import { SEASON_STATUS_TONE, SEASON_TYPE_TONE } from './SeasonsPage'
import '../membership/member-list.css'
import './seasons.css'

type Person = { name_bn: string; name_en: string | null } | null
type Detail = Season & {
  created_at: string
  updated_at: string
  creator: Person
  updated_by: Person
  lands: number
  area_decimal: number
  farmers: number
  rates: number
  can_delete: boolean
}
type Meta = { statuses: Record<string, string>; types: Record<string, string> }

function Fact({ icon, label, value, color, tint }: { icon: ReactNode; label: string; value: ReactNode; color: string; tint: string }) {
  return (
    <div className="sn-fact" style={{ background: tint }}>
      <span className="sn-fact-icon" style={{ color }}>
        {icon}
      </span>
      <span>
        <small>{label}</small>
        <strong style={{ color }}>{value}</strong>
      </span>
    </div>
  )
}

/** One season: its facts and what was billed in it. */
export default function SeasonDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: s } = useQuery({ queryKey: ['seasons', id], queryFn: async () => (await api.get<Detail>(`/seasons/${id}`)).data })
  const meta = useQuery({ queryKey: ['seasons'], queryFn: async () => (await api.get<Meta>('/seasons')).data })

  const statusTag = s && <Tag className={`fl-tag ${SEASON_STATUS_TONE[s.status] ?? 'll-gray'}`}>{meta.data?.statuses[s.status] ?? s.status}</Tag>
  const typeLabel = s?.type ? (meta.data?.types[s.type] ?? s.type) : '—'
  const related = s
    ? [
        { key: 'lands', label: tx('জমির রেকর্ড'), value: n0(s.lands), hint: tx('এই মৌসুমে বিল হওয়া জমি'), icon: 'layers', color: '#8b3fe0', tint: '#efe4fc', to: `/irrigation/invoices?season_id=${s.id}` },
        { key: 'area', label: tx('সেচকৃত জমি'), value: acres(s.area_decimal), hint: tx('একর'), icon: 'sprout', color: '#1f9d55', tint: '#dcf3e5', to: `/irrigation/invoices?season_id=${s.id}` },
        { key: 'farmers', label: tx('সংশ্লিষ্ট কৃষক'), value: n0(s.farmers), hint: tx('এই মৌসুমে বিল হওয়া কৃষক'), icon: 'users', color: '#f08c00', tint: '#fdefd6', to: `/irrigation/invoices?season_id=${s.id}` },
        { key: 'invoices', label: tx('সেচের ইনভয়েস'), value: n0(s.invoice_count), hint: tx('বিল {{p0}} · আদায় {{p1}}', { p0: money(s.billed), p1: money(s.collected) }), icon: 'drop', color: '#1769e0', tint: '#e4edfd', to: `/irrigation/invoices?season_id=${s.id}` },
      ]
    : []

  return (
    <PageFrame
      className="sn-detail"
      crumbs={[{ label: tx('সেচ'), to: '/irrigation/invoices' }, { label: tx('মৌসুমের তালিকা'), to: '/irrigation/seasons' }, { label: tx('মৌসুমের বিস্তারিত') }]}
      title={tx('মৌসুমের বিস্তারিত')}
      subtitle={tx('বাছাই করা কৃষি মৌসুমের বিস্তারিত তথ্য দেখুন।')}
      actions={
        <>
          {can('irrigation.edit') && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/irrigation/seasons/${id}/edit`)}>
              {tx('মৌসুম সম্পাদনা')}
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/irrigation/seasons')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </>
      }
    >
      {!s ? (
        <Spin />
      ) : (
        <>
          <div className="sn-top">
            <div className="sn-hero">
              <span className="sn-badge">
                <DashIcon name="sprout" size={48} color="#1f9d55" stroke={2.1} />
              </span>
              <div>
                <h2>{s.name_bn}</h2>
                {statusTag}
                <p>{s.remarks || s.crop || tx('কোনো বিবরণ নেই।')}</p>
              </div>
            </div>
            <div className="sn-facts">
              <Fact icon={<TagFilled />} label={tx('মৌসুমের কোড')} value={s.code ?? '—'} color="#1769e0" tint="#eef4fe" />
              <Fact icon={<DashIcon name="sprout" size={20} color="#8b3fe0" stroke={2.2} />} label={tx('মৌসুমের ধরন')} value={typeLabel} color="#8b3fe0" tint="#f5effd" />
              <Fact icon={<CalendarFilled />} label={tx('শুরুর তারিখ')} value={fmtDate(s.start_date)} color="#1f9d55" tint="#ebf8f0" />
              <Fact icon={<CalendarFilled />} label={tx('শেষের তারিখ')} value={fmtDate(s.end_date)} color="#f08c00" tint="#fef5e7" />
            </div>
          </div>

          <section className="sn-section">
            <header>
              <FileTextFilled />
              <h3>{tx('মূল তথ্য')}</h3>
            </header>
            <div className="sn-info">
              <dl>
                <dt>{tx('মৌসুমের নাম')}</dt>
                <span>:</span>
                <dd>{s.name_bn}</dd>
                <dt>{tx('মৌসুমের কোড')}</dt>
                <span>:</span>
                <dd>{s.code ?? '—'}</dd>
                <dt>{tx('মৌসুমের ধরন')}</dt>
                <span>:</span>
                <dd>{s.type ? <Tag className={`fl-tag ${SEASON_TYPE_TONE[s.type] ?? 'll-gray'}`}>{typeLabel}</Tag> : '—'}</dd>
                <dt>{tx('শুরুর তারিখ')}</dt>
                <span>:</span>
                <dd>{fmtDate(s.start_date)}</dd>
                <dt>{tx('শেষের তারিখ')}</dt>
                <span>:</span>
                <dd>{fmtDate(s.end_date)}</dd>
                <dt>{tx('পরিশোধের শেষ তারিখ')}</dt>
                <span>:</span>
                <dd>{s.due_date ? fmtDate(s.due_date) : '—'}</dd>
                <dt>{tx('অবস্থা')}</dt>
                <span>:</span>
                <dd>{statusTag}</dd>
              </dl>
              <dl>
                <dt>{tx('ফসল')}</dt>
                <span>:</span>
                <dd>{s.crop || '—'}</dd>
                <dt>{tx('তৈরি করেছেন')}</dt>
                <span>:</span>
                <dd>{nameOf(s.creator) || '—'}</dd>
                <dt>{tx('তৈরির তারিখ')}</dt>
                <span>:</span>
                <dd>{fmtDateTime(s.created_at)}</dd>
                <dt>{tx('সর্বশেষ সম্পাদনা করেছেন')}</dt>
                <span>:</span>
                <dd>{nameOf(s.updated_by) || nameOf(s.creator) || '—'}</dd>
                <dt>{tx('সর্বশেষ সম্পাদনার সময়')}</dt>
                <span>:</span>
                <dd>{fmtDateTime(s.updated_at)}</dd>
                <dt>{tx('সেচের রেট')}</dt>
                <span>:</span>
                <dd>{tx('{{p0}}টি', { p0: n0(s.rates) })}</dd>
              </dl>
            </div>
          </section>

          <section className="sn-section">
            <header>
              <LinkOutlined />
              <h3>{tx('সংশ্লিষ্ট তথ্য')}</h3>
            </header>
            <div className="sn-related ml-stats">
              {related.map((r) => (
                <button key={r.key} type="button" className="fl-stat" style={{ ['--tint' as string]: r.tint }} onClick={() => navigate(r.to)}>
                  <span className="fl-stat-icon" style={{ background: r.tint }}>
                    <DashIcon name={r.icon} size={30} color={r.color} stroke={2.1} />
                  </span>
                  <span className="fl-stat-body">
                    <span className="fl-stat-label">{r.label}</span>
                    <span className="fl-stat-value">{r.value}</span>
                    <small>{r.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="sn-section">
            <header>
              <FileTextFilled />
              <h3>{tx('মন্তব্য')}</h3>
            </header>
            <div className="sn-remarks">
              <MinusCircleFilled style={{ fontSize: 30, color: '#c3c9d4' }} />
              {s.remarks || tx('কোনো অতিরিক্ত মন্তব্য নেই।')}
            </div>
          </section>
        </>
      )}
    </PageFrame>
  )
}
