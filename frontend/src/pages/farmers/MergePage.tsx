import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, ConfigProvider, Form, Input, Modal, Radio, Select, Spin, Table, Tag, Tooltip } from 'antd'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  UnorderedListOutlined,
  HomeOutlined,
  RightOutlined,
  SearchOutlined,
  SettingFilled,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import ProtectedImage from '../../components/ProtectedImage'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDate } from '../../lib/format'
import { MEMBER_STATUS, useFarmerMeta, type FarmerMeta, type FarmerRow, type MemberStatus } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import { DashIcon } from '../dashboard/DashIcons'
import './farmer-list.css'
import './farmer-merge.css'

type Related = { land: number; irrigation: number; savings: number; loan: number; membership: boolean; voter: number }
type F = Record<string, unknown> & {
  id: number
  farmer_code: string
  name_bn: string
  name_en: string | null
  father_name: string
  mobile: string | null
  nid: string | null
  is_active: boolean
  photo_url: string | null
  village: { name_bn: string } | null
  mouza: { name_bn: string } | null
  member: { member_no: number; status: MemberStatus } | null
  household: { code: string } | null
  related: Related
}
type Side = 'source' | 'target'

const empty = (v: unknown) => v === null || v === undefined || v === ''
const coded = (meta: FarmerMeta | undefined, key: keyof FarmerMeta, v: unknown) => (empty(v) ? '' : (meta?.[key][String(v)] ?? String(v)))

/**
 * One comparison row. A row may carry several fields that only make sense
 * together (village + mouza, the address parts); the choice applies to all.
 */
type RowDef = { key: string; label: string; fields: string[]; show: (f: F, meta?: FarmerMeta) => string }
const ROWS: RowDef[] = [
  { key: 'name', label: tx('কৃষকের নাম'), fields: ['name_bn', 'name_en'], show: (f) => nameOf(f) },
  { key: 'father', label: tx('পিতার নাম'), fields: ['father_name'], show: (f) => String(f.father_name ?? '') },
  { key: 'mother', label: tx('মাতার নাম'), fields: ['mother_name'], show: (f) => String(f.mother_name ?? '') },
  { key: 'spouse', label: tx('স্বামী/স্ত্রী'), fields: ['spouse_name'], show: (f) => String(f.spouse_name ?? '') },
  { key: 'gender', label: tx('লিঙ্গ'), fields: ['gender'], show: (f, m) => coded(m, 'genders', f.gender) },
  { key: 'mobile', label: tx('মোবাইল নম্বর'), fields: ['mobile'], show: (f) => digits(f.mobile ?? '') },
  { key: 'alt_mobile', label: tx('বিকল্প মোবাইল'), fields: ['alt_mobile'], show: (f) => digits(String(f.alt_mobile ?? '')) },
  { key: 'email', label: tx('ইমেইল'), fields: ['email'], show: (f) => String(f.email ?? '') },
  { key: 'nid', label: 'NID', fields: ['nid'], show: (f) => digits(f.nid ?? '') },
  { key: 'birth_reg', label: tx('জন্ম নিবন্ধন'), fields: ['birth_reg_no'], show: (f) => digits(String(f.birth_reg_no ?? '')) },
  { key: 'dob', label: tx('জন্মতারিখ'), fields: ['date_of_birth'], show: (f) => (f.date_of_birth ? fmtDate(f.date_of_birth as string) : '') },
  { key: 'occupation', label: tx('পেশা'), fields: ['occupation'], show: (f, m) => coded(m, 'occupations', f.occupation) },
  { key: 'mouza', label: tx('মৌজা'), fields: ['village_id', 'mouza_id'], show: (f) => [f.mouza?.name_bn, f.village && `${tx('গ্রাম')}: ${f.village.name_bn}`].filter(Boolean).join(' · ') },
  {
    key: 'address',
    label: tx('ঠিকানা'),
    fields: ['para', 'post_office', 'post_code'],
    show: (f) =>
      [f.para && `${tx('পাড়া')}: ${f.para}`, f.post_office && `${tx('ডাকঘর')}: ${f.post_office}${f.post_code ? ` - ${digits(String(f.post_code))}` : ''}`].filter(Boolean).join(', '),
  },
  { key: 'education', label: tx('শিক্ষাগত যোগ্যতা'), fields: ['education_level'], show: (f, m) => coded(m, 'education_levels', f.education_level) },
  { key: 'blood', label: tx('রক্তের গ্রুপ'), fields: ['blood_group'], show: (f, m) => coded(m, 'blood_groups', f.blood_group) },
  { key: 'type', label: tx('কৃষকের ধরন'), fields: ['farmer_type'], show: (f, m) => coded(m, 'farmer_types', f.farmer_type) },
  {
    key: 'household',
    label: tx('খানা'),
    fields: ['household_id', 'household_relation'],
    show: (f, m) => [f.household?.code, coded(m, 'relations', f.household_relation)].filter(Boolean).join(' · '),
  },
  { key: 'photo', label: tx('ছবি'), fields: ['photo'], show: (f) => (f.photo ? tx('আছে') : '') },
  { key: 'remarks', label: tx('মন্তব্য'), fields: ['remarks'], show: (f) => String(f.remarks ?? '') },
]

const initials = (name: string) =>
  name
    .replace(/^(Md\.|Mst\.|মোঃ|মোছাঃ)\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** Search box + result list for picking one farmer. */
function FarmerPicker({ exclude, onPick }: { exclude?: number; onPick: (id: number) => void }) {
  const { message } = App.useApp()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<FarmerRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!q.trim()) return
    setLoading(true)
    try {
      const r = await api.get<Paginated<FarmerRow>>('/farmers', { params: { search: q.trim(), per_page: 10 } })
      setResults(r.data.data.filter((f) => f.id !== exclude))
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fm-picker">
      <div className="fm-search">
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder={tx('নাম, মোবাইল, NID, সদস্য নং দিয়ে খুঁজুন...')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (!e.target.value) setResults(null)
          }}
          onPressEnter={search}
        />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={search}>
          {tx('খুঁজুন')}
        </Button>
      </div>
      {results && (
        <div className="fm-results">
          {results.length === 0 ? (
            <div className="fm-noresult">{tx('কোনো কৃষক পাওয়া যায়নি')}</div>
          ) : (
            results.map((f) => (
              <button
                key={f.id}
                type="button"
                className="fm-result"
                onClick={() => {
                  onPick(f.id)
                  setResults(null)
                  setQ('')
                }}
              >
                <strong>{nameOf(f)}</strong>
                <span>
                  {f.farmer_code} · {digits(f.mobile ?? '—')} · {f.father_name}
                  {f.member && ` · ${tx('সদস্য নং')} ${digits(f.member.member_no)}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function FarmerCard({ f, side, onClear }: { f: F; side: Side; onClear: () => void }) {
  const kv = (label: string, value: ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd>
        <span>:</span> {value}
      </dd>
    </>
  )
  return (
    <div className="fm-farmer">
      {f.photo_url ? <ProtectedImage url={f.photo_url} size={72} shape="square" /> : <span className="fm-initials">{initials(nameOf(f))}</span>}
      <div className="fm-farmer-body">
        <div className="fm-farmer-name">
          <Link to={`/farmers/${f.id}`}>{nameOf(f)}</Link>
          <Tag className={`fm-side-tag fm-side-${side}`}>{side === 'source' ? tx('উৎস') : tx('লক্ষ্য')}</Tag>
        </div>
        <div className="fm-farmer-grid">
          <dl>
            {kv(tx('কৃষক নং'), f.farmer_code)}
            {kv(tx('মোবাইল'), digits(f.mobile ?? '—'))}
            {kv('NID', digits(f.nid ?? '—'))}
          </dl>
          <dl>
            {kv(tx('পিতার নাম'), f.father_name)}
            {kv(tx('মৌজা'), f.mouza?.name_bn ?? '—')}
            {kv(tx('অবস্থা'), f.member ? MEMBER_STATUS[f.member.status]?.label : f.is_active ? tx('সক্রিয়') : tx('নিষ্ক্রিয়'))}
            {kv(tx('সদস্যপদ'), f.member ? tx('হ্যাঁ ({{p0}})', { p0: digits(f.member.member_no) }) : tx('না'))}
          </dl>
        </div>
      </div>
      <Button type="text" className="fm-clear" icon={<CloseOutlined />} aria-label={tx('সরান')} onClick={onClear} />
    </div>
  )
}

export default function MergePage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { user } = useAuth()
  // a Super Admin's merge applies at once; everyone else's waits for approval
  const direct = !!user?.is_super_admin
  const { data: meta } = useFarmerMeta()
  // ?a= is the record to keep (target), ?b= the one merged away (source) — as the duplicates page links it.
  const targetId = Number(sp.get('a')) || undefined
  const sourceId = Number(sp.get('b')) || undefined
  // ?edit= changes a waiting request (it keeps its number)
  const editId = Number(sp.get('edit')) || undefined
  const [reason, setReason] = useState(sp.get('reason') ?? 'duplicate')
  const [reasonNote, setReasonNote] = useState('')
  const [choices, setChoices] = useState<Record<string, Side>>({})
  const [transfer, setTransfer] = useState({ land: true, irrigation: true })
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data, isFetching, error } = useQuery({
    queryKey: ['farmer-compare', targetId, sourceId],
    queryFn: async () => (await api.get<{ a: F | null; b: F | null; fields: string[] }>('/farmers/compare', { params: { a: targetId, b: sourceId } })).data,
    enabled: !!(targetId || sourceId),
  })
  const mergeMeta = useQuery({ queryKey: ['merge-history', 'meta'], queryFn: async () => (await api.get<{ reasons: Record<string, string> }>('/farmers-merge/meta')).data })

  const target = targetId ? (data?.a ?? null) : null
  const source = sourceId ? (data?.b ?? null) : null

  const pick = (side: Side, id?: number) => {
    const next = new URLSearchParams(sp)
    const key = side === 'target' ? 'a' : 'b'
    if (id) next.set(key, String(id))
    else next.delete(key)
    setSp(next, { replace: true })
    setChoices({})
  }

  const rows = useMemo(() => {
    if (!source || !target) return []
    return ROWS.map((r) => ({ ...r, s: r.show(source, meta), t: r.show(target, meta) })).filter((r) => r.key === 'name' || r.s || r.t)
  }, [source, target, meta])

  // Default: the target's value, or the source's when the target has none.
  const chosen = (r: (typeof rows)[number]): Side => choices[r.key] ?? (!r.t && r.s ? 'source' : 'target')

  const bothMembers = !!source?.member && !!target?.member
  const ready = !!source && !!target && !bothMembers
  const rel = source?.related

  const submit = async () => {
    if (!source || !target) return
    setSaving(true)
    try {
      const mapped: Record<string, 'keep' | 'remove'> = {}
      for (const r of rows) for (const field of r.fields) mapped[field] = chosen(r) === 'source' ? 'remove' : 'keep'
      const body = {
        keep_id: target.id,
        remove_id: source.id,
        choices: mapped,
        transfer: (Object.keys(transfer) as (keyof typeof transfer)[]).filter((k) => transfer[k]),
        reason,
        reason_note: reasonNote || null,
      }
      const r = editId ? await api.put(`/farmers-merge/${editId}`, body) : await api.post('/farmers-merge', body)
      message.success(r.data.message)
      navigate(r.data.status === 'approved' ? `/farmers/${target.id}` : '/farmers/merge')
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const followsMember = () => message.info(tx('এই তথ্য সদস্যপদের সাথে যুক্ত, তাই সদস্যপদের সাথেই স্থানান্তর হবে।'))
  const related: { key: string; icon: string; color: string; tint: string; label: string; note: string; checked: boolean; onChange: () => void }[] = rel
    ? [
        { key: 'land', icon: 'sprout', color: '#16a34a', tint: '#e5f6ec', label: tx('জমির রেকর্ড'), note: tx('{{p0}}টি জমির রেকর্ড', { p0: digits(rel.land) }), checked: transfer.land, onChange: () => setTransfer((t) => ({ ...t, land: !t.land })) },
        { key: 'irrigation', icon: 'drop', color: '#1d8fe0', tint: '#e3f1fd', label: tx('সেচের রেকর্ড'), note: tx('{{p0}}টি ইনভয়েস', { p0: digits(rel.irrigation) }), checked: transfer.irrigation, onChange: () => setTransfer((t) => ({ ...t, irrigation: !t.irrigation })) },
        { key: 'savings', icon: 'piggy', color: '#f08c00', tint: '#fff1dc', label: tx('সঞ্চয়ের রেকর্ড'), note: tx('{{p0}}টি লেনদেন', { p0: digits(rel.savings) }), checked: rel.membership, onChange: followsMember },
        { key: 'loan', icon: 'handCoins', color: '#16a34a', tint: '#e5f6ec', label: tx('ঋণের রেকর্ড'), note: tx('{{p0}}টি ঋণ', { p0: digits(rel.loan) }), checked: rel.membership, onChange: followsMember },
        { key: 'membership', icon: 'users', color: '#1769e0', tint: '#e4edfd', label: tx('সদস্যপদ'), note: tx('সদস্যপদ স্থানান্তর'), checked: rel.membership, onChange: followsMember },
        { key: 'voter', icon: 'file', color: '#6d4ae6', tint: '#ece7fc', label: tx('ভোটার অবস্থা'), note: tx('ভোটার অবস্থা স্থানান্তর'), checked: rel.membership, onChange: followsMember },
      ]
    : []

  const step = (n: number, title: string, desc: string, extra?: ReactNode) => (
    <div className="fm-step">
      <span className="fm-step-no">{digits(n)}</span>
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      {extra}
    </div>
  )

  const box = (side: Side) => {
    const f = side === 'source' ? source : target
    return (
      <div className={`fm-box fm-box-${side}`}>
        <div className="fm-box-title">
          {side === 'source' ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}
          <strong>{side === 'source' ? tx('উৎস কৃষক') : tx('লক্ষ্য কৃষক')}</strong>
          <em>{side === 'source' ? tx('(মার্জ হয়ে মুছে যাবে)') : tx('(রাখা হবে)')}</em>
        </div>
        <FarmerPicker exclude={side === 'source' ? targetId : sourceId} onPick={(id) => pick(side, id)} />
        {f ? (
          <FarmerCard f={f} side={side} onClear={() => pick(side)} />
        ) : (
          <div className="fm-farmer fm-farmer-empty">{isFetching && (side === 'source' ? sourceId : targetId) ? <Spin /> : tx('উপরে খুঁজে একজন কৃষক বাছাই করুন')}</div>
        )}
      </div>
    )
  }

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl fm">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers/merge">{tx('কৃষক মার্জের তালিকা')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{editId ? tx('মার্জ অনুরোধ সম্পাদনা') : tx('নতুন মার্জ অনুরোধ')}</span>
        </nav>

        <div className="fl-head">
          <div>
            <h1>{tx('কৃষক মার্জ')}</h1>
            <p>{tx('একই কৃষকের একাধিক রেকর্ড একটিতে মিলিয়ে দিন। উৎস কৃষক (মার্জ হয়ে যাবে) এবং লক্ষ্য কৃষক (রাখা হবে) বাছাই করুন।')}</p>
          </div>
          <div className="fl-head-btns">
            <Button icon={<UnorderedListOutlined />} className="fm-history-btn" onClick={() => navigate('/farmers/merge')}>
              {tx('মার্জের তালিকা')}
            </Button>
          </div>
        </div>

        {error && <Alert type="error" showIcon className="fm-alert" title={errorMessage(error)} />}

        <section className="fm-section">
          {step(1, tx('কৃষক খুঁজুন ও বাছাই করুন'), tx('যে দুটি কৃষক রেকর্ড মার্জ করতে চান সেগুলো খুঁজে বাছাই করুন। নাম, মোবাইল, NID বা সদস্য নং দিয়ে খোঁজা যাবে।'))}
          <div className="fm-boxes">
            {box('source')}
            {box('target')}
          </div>
          {bothMembers && <Alert type="error" showIcon className="fm-alert" title={tx('দুজনই সদস্য। মার্জের আগে একজনের সদস্যপদ বাতিল করতে হবে।')} />}
        </section>

        <section className="fm-section">
          {step(
            2,
            tx('তথ্য মিলিয়ে দেখুন'),
            tx('দুটি রেকর্ডের তথ্য দেখুন। চূড়ান্ত রেকর্ডে কোন তথ্য থাকবে তা বাছাই করুন।'),
            <Button className="fm-auto" icon={<SettingFilled />} disabled={!rows.length} onClick={() => setChoices(Object.fromEntries(rows.map((r) => [r.key, r.t || !r.s ? 'target' : 'source'])))}>
              {tx('স্বয়ংক্রিয় বাছাই (লক্ষ্য রাখুন)')}
            </Button>,
          )}
          <Table
            className="fm-compare"
            rowKey="key"
            size="small"
            pagination={false}
            scroll={{ x: 900 }}
            dataSource={rows}
            locale={{ emptyText: tx('তুলনা করতে উৎস ও লক্ষ্য দুই কৃষকই বাছাই করুন') }}
            columns={[
              { title: tx('তথ্যের ঘর'), dataIndex: 'label', width: '17%' },
              {
                title: source ? tx('উৎস কৃষক ({{p0}})', { p0: source.farmer_code }) : tx('উৎস কৃষক'),
                width: '24%',
                render: (_, r) => (
                  <span className="fm-cell" onClick={() => setChoices((c) => ({ ...c, [r.key]: 'source' }))}>
                    {r.s || '—'}
                  </span>
                ),
              },
              {
                title: target ? tx('লক্ষ্য কৃষক ({{p0}})', { p0: target.farmer_code }) : tx('লক্ষ্য কৃষক'),
                width: '24%',
                render: (_, r) => (
                  <span className="fm-cell" onClick={() => setChoices((c) => ({ ...c, [r.key]: 'target' }))}>
                    {r.t || '—'}
                  </span>
                ),
              },
              {
                title: tx('চূড়ান্ত (মার্জের পর)'),
                render: (_, r) => (
                  <div className="fm-final">
                    <Tooltip title={chosen(r) === 'source' ? tx('উৎসের তথ্য রাখা হবে — লক্ষ্যের তথ্য নিতে ক্লিক করুন') : tx('লক্ষ্যের তথ্য রাখা হবে — উৎসের তথ্য নিতে ক্লিক করুন')}>
                      <Radio checked={chosen(r) === 'source'} onClick={() => setChoices((c) => ({ ...c, [r.key]: chosen(r) === 'source' ? 'target' : 'source' }))} />
                    </Tooltip>
                    <span className="fm-final-value">{(chosen(r) === 'source' ? r.s : r.t) || '—'}</span>
                  </div>
                ),
              },
            ]}
          />
        </section>

        <section className="fm-section">
          {step(3, tx('মার্জ করার সংশ্লিষ্ট তথ্য'), tx('উৎস কৃষকের কোন সংশ্লিষ্ট তথ্য লক্ষ্য কৃষকের কাছে স্থানান্তর হবে তা বাছাই করুন।'))}
          {rel ? (
            <div className="fm-related">
              {related.map((r) => (
                <label key={r.key} className="fm-rel">
                  <Checkbox checked={r.checked} onChange={r.onChange} />
                  <span className="fm-rel-icon" style={{ background: r.tint }}>
                    <DashIcon name={r.icon} size={22} color={r.color} stroke={2.1} />
                  </span>
                  <span className="fm-rel-text">
                    <strong>{r.label}</strong>
                    <small>{r.note}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="fm-placeholder">{tx('উৎস কৃষক বাছাই করলে তার সংশ্লিষ্ট তথ্য এখানে দেখাবে')}</div>
          )}
        </section>

        <div className="fm-actions">
          <Button onClick={() => navigate(-1)}>{tx('বাতিল')}</Button>
          <Button type="primary" icon={<ArrowRightOutlined />} disabled={!ready} onClick={() => setPreview(true)}>
            {tx('মার্জের প্রিভিউ')}
          </Button>
        </div>

        <Modal
          open={preview}
          width={640}
          title={tx('মার্জের প্রিভিউ')}
          onCancel={() => setPreview(false)}
          onOk={submit}
          confirmLoading={saving}
          okText={direct ? tx('মার্জ করুন') : editId ? tx('পরিবর্তন সংরক্ষণ') : tx('মার্জের অনুরোধ পাঠান')}
          cancelText={tx('বাতিল')}
        >
          {source && target && (
            <div className="fm-preview">
              <p>
                <Tag color="red">{source.farmer_code}</Tag> {nameOf(source)} <ArrowRightOutlined /> <Tag color="green">{target.farmer_code}</Tag> {nameOf(target)}
              </p>
              <table>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th>{r.label}</th>
                      <td>
                        {(chosen(r) === 'source' ? r.s : r.t) || '—'}
                        {chosen(r) === 'source' && r.s !== r.t && <Tag className="fm-from-source">{tx('উৎস থেকে')}</Tag>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Form layout="vertical" className="fm-reason">
                <Form.Item label={tx('মার্জের কারণ')} required>
                  <Select value={reason} onChange={setReason} options={Object.entries(mergeMeta.data?.reasons ?? {}).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
                <Form.Item label={tx('মন্তব্য (ঐচ্ছিক)')}>
                  <Input maxLength={255} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
                </Form.Item>
              </Form>
              <p className="fm-preview-moves">
                {tx('স্থানান্তর হবে')}: {related.filter((r) => r.checked).map((r) => r.label).join(', ') || '—'}
                {tx('; সাথে ডকুমেন্ট, আবেদন ও পরিবারের তথ্য।')}
              </p>
              <Alert type="warning" showIcon title={direct ? tx('সুপার অ্যাডমিন হিসেবে মার্জ সঙ্গে সঙ্গে কার্যকর হবে: উৎস রেকর্ডটি নিষ্ক্রিয় হয়ে লক্ষ্য রেকর্ডের সাথে যুক্ত থাকবে। এটি ফেরানো যায় না।') : tx('অনুমোদনের পর উৎস রেকর্ডটি নিষ্ক্রিয় হয়ে লক্ষ্য রেকর্ডের সাথে যুক্ত থাকবে। এটি ফেরানো যায় না।')} />
            </div>
          )}
        </Modal>

      </div>
    </ConfigProvider>
  )
}
