import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { App, Button, Checkbox, ConfigProvider, Dropdown, Input, Modal, Pagination, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  EyeFilled,
  HomeOutlined,
  IdcardOutlined,
  InsertRowRightOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  RightOutlined,
  SearchOutlined,
  TeamOutlined,
  UploadOutlined,
  UpOutlined,
  UsergroupDeleteOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import LocationCascader, { type LocationPath } from '../../components/LocationCascader'
import ProtectedImage from '../../components/ProtectedImage'
import QrLabel from '../../components/QrLabel'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits } from '../../lib/format'
import { downloadExport, toOptions, useFarmerMeta, type FarmerRow, type FarmerSummary } from '../../lib/phase2'
import { nameOf, t as tx } from '../../lib/i18n'
import { usePublicSettings } from '../../lib/settings'
import type { Mouza } from '../../lib/types'
import { DashIcon } from '../dashboard/DashIcons'
import DeleteFarmerModal from './DeleteFarmerModal'
import './farmer-list.css'
import PageTabs from '../../components/PageTabs'

type Filters = { search?: string; mouza_id?: number; member_status?: string; occupation?: string; land_owner?: string; is_active?: string; union_id?: number; village_id?: number }
type Params = Filters & { page: number; per_page: number; type?: string }

const n0 = (v: number) => digits(v.toLocaleString('en-IN'))
const pct = (part: number, total: number) => (total ? digits(((part / total) * 100).toFixed(1)) + '%' : digits('0%'))

/** Member-status tag: an actual membership first, then a pending application, else non-member. */
function statusTag(f: FarmerRow) {
  if (f.member?.status === 'active') return <Tag className="fl-tag fl-tag-green">{tx('সক্রিয় সদস্য')}</Tag>
  if (f.member?.status === 'inactive') return <Tag className="fl-tag fl-tag-orange">{tx('নিষ্ক্রিয় সদস্য')}</Tag>
  if (f.member?.status === 'cancelled') return <Tag className="fl-tag fl-tag-red">{tx('বাতিল সদস্য')}</Tag>
  if (f.pending_application) return <Tag className="fl-tag fl-tag-gold">{tx('অপেক্ষমাণ')}</Tag>
  return <Tag className="fl-tag fl-tag-red">{tx('সদস্য নন')}</Tag>
}

export default function FarmerListPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { message } = App.useApp()
  const { data: meta } = useFarmerMeta()
  const { data: settings } = usePublicSettings()
  // the top-bar search and dashboard cards open this list with ?search= / ?type=
  const [sp] = useSearchParams()
  const urlSearch = sp.get('search') || undefined
  const urlType = sp.get('type') || undefined
  const [params, setParams] = useState<Params>({ page: 1, per_page: 10, search: urlSearch, type: urlType })
  const [draft, setDraft] = useState<Filters>({ search: urlSearch })
  useEffect(() => {
    setParams((p) => ({ ...p, search: urlSearch, type: urlType, page: 1 }))
    setDraft((d) => ({ ...d, search: urlSearch }))
  }, [urlSearch, urlType])
  const [path, setPath] = useState<LocationPath>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [cardsOpen, setCardsOpen] = useState(false)
  const [deleting, setDeleting] = useState<FarmerRow | null>(null)

  const apply = (patch: Partial<Filters> = {}) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setParams((p) => ({ page: 1, per_page: p.per_page, type: p.type, ...next }))
  }
  const reset = () => {
    setDraft({})
    setPath([])
    setParams((p) => ({ page: 1, per_page: p.per_page }))
    if (urlSearch || urlType) navigate('/farmers', { replace: true })
  }

  const { data, isFetching } = useQuery({
    queryKey: ['farmers', params],
    queryFn: async () => (await api.get<Paginated<FarmerRow>>('/farmers', { params })).data,
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({ queryKey: ['farmers', 'summary'], queryFn: async () => (await api.get<FarmerSummary>('/farmers/summary')).data })
  const mouzas = useQuery({ queryKey: ['mouzas', 'all'], queryFn: async () => (await api.get<Mouza[]>('/mouzas', { params: { all: 1 } })).data })

  const exportCsv = async () => {
    try {
      await downloadExport('/farmers/export', { ...params, page: undefined }, 'farmers.csv')
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const from = total ? (params.page - 1) * params.per_page + 1 : 0
  const to = Math.min(params.page * params.per_page, total)
  const s = summary.data
  const cardRows = selected.length ? rows.filter((r) => selected.includes(r.id)) : rows

  const cards = [
    { key: 'total', label: tx('মোট কৃষক'), value: s ? n0(s.total) : '—', icon: 'users', color: '#1f9d55', tint: '#e3f5ea' },
    { key: 'members', label: tx('সদস্য কৃষক'), value: s ? n0(s.members) : '—', icon: 'users', color: '#2563eb', tint: '#e4edfd', pill: s && pct(s.members, s.total), tone: 'up', type: 'member' },
    { key: 'non', label: tx('নন-মেম্বার কৃষক'), value: s ? n0(s.non_members) : '—', icon: 'users', color: '#e0383e', tint: '#fde6e7', pill: s && pct(s.non_members, s.total), tone: 'down', type: 'non_member' },
    { key: 'pending', label: tx('অপেক্ষমাণ সদস্যপদ'), value: s ? n0(s.pending) : '—', icon: 'userClock', color: '#f08c00', tint: '#fdf0dc', pill: s && pct(s.pending, s.total), tone: 'down', status: 'pending' },
    { key: 'land', label: tx('মোট জমি'), value: s ? digits(s.land_acre.toLocaleString('en-IN', { maximumFractionDigits: 2 })) : '—', unit: tx('একর'), icon: 'layers', color: '#6d4ae6', tint: '#ece7fc' },
  ]

  const allColumns: (ColumnsType<FarmerRow>[number] & { key: string })[] = [
    { key: 'sl', title: '#', width: 46, align: 'center', render: (_, __, i) => digits(from + i) },
    { key: 'photo', title: tx('ছবি'), width: 62, render: (_, f) => <ProtectedImage url={f.photo_url} size={36} shape="square" /> },
    {
      key: 'code',
      title: 'Farmer ID',
      dataIndex: 'farmer_code',
      width: 96,
      render: (v, f) => (
        <Link to={`/farmers/${f.id}`} className="fl-link">
          {v}
        </Link>
      ),
    },
    {
      key: 'name',
      title: tx('নাম'),
      dataIndex: 'name_bn',
      render: (_, f) => (
        <Link to={`/farmers/${f.id}`} className="fl-name">
          {nameOf(f)}
        </Link>
      ),
    },
    { key: 'father', title: tx('পিতার নাম'), dataIndex: 'father_name' },
    { key: 'mobile', title: tx('মোবাইল'), dataIndex: 'mobile', render: (v) => digits(v) || '—' },
    { key: 'nid', title: 'NID', dataIndex: 'nid', render: (v) => digits(v) || '—' },
    { key: 'mouza', title: tx('মৌজা'), dataIndex: 'mouza', render: (v) => v || '—' },
    { key: 'land', title: tx('মোট জমি'), dataIndex: 'land_acre', render: (v) => digits(Number(v ?? 0).toFixed(2)) },
    { key: 'member_no', title: tx('সদস্য নং'), render: (_, f) => (f.member ? <span className="fl-link">{digits(f.member.member_no)}</span> : '-') },
    { key: 'status', title: tx('সদস্য অবস্থা'), render: (_, f) => statusTag(f) },
    {
      key: 'actions',
      title: tx('অ্যাকশন'),
      width: 128,
      render: (_, f) => {
        const items = [
          can('membership.create') && !f.member && !f.pending_application && f.is_active && { key: 'apply', icon: <UserAddOutlined />, label: tx('সদস্য করুন'), onClick: () => navigate(`/membership/applications/new?farmer=${f.id}`) },
          { key: 'profile', icon: <IdcardOutlined />, label: tx('প্রোফাইল'), onClick: () => navigate(`/farmers/${f.id}`) },
          can('farmer.delete') && !f.member && !f.pending_application && { key: 'delete', danger: true, icon: <DeleteOutlined />, label: tx('মুছুন'), onClick: () => setDeleting(f) },
        ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]
        return (
          <div className="fl-actions">
            <Button className="fl-act fl-act-view" icon={<EyeFilled />} aria-label={tx('দেখুন')} onClick={() => navigate(`/farmers/${f.id}`)} />
            <Button className="fl-act" icon={<EditOutlined />} aria-label={tx('সম্পাদনা')} disabled={!can('farmer.edit')} onClick={() => navigate(`/farmers/${f.id}/edit`)} />
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button className="fl-act" icon={<MoreOutlined />} aria-label={tx('আরও')} />
            </Dropdown>
          </div>
        )
      },
    },
  ]
  const hideable = allColumns.filter((c) => !['sl', 'actions'].includes(c.key))
  const columns = allColumns.filter((c) => !hidden.includes(c.key))

  const moreItems = [
    { key: 'households', icon: <TeamOutlined />, label: tx('খানা'), onClick: () => navigate('/households') },
    { key: 'duplicates', icon: <UsergroupDeleteOutlined />, label: tx('ডুপ্লিকেট পর্যালোচনা'), onClick: () => navigate('/farmers/duplicates') },
    can('farmer.edit') && { key: 'merge', icon: <CopyOutlined />, label: tx('কৃষক একীভূত'), onClick: () => navigate('/farmers/merge/new') },
    { key: 'deleted', icon: <DeleteOutlined />, label: tx('মুছে ফেলা কৃষক'), onClick: () => navigate('/farmers/deleted') },
    can('farmer.export') && { key: 'excel', icon: <DownloadOutlined />, label: 'Excel', onClick: exportCsv },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[]

  const pageSizeSelect = <Select value={params.per_page} className="fl-size" options={[10, 25, 50, 100].map((v) => ({ value: v, label: digits(v) }))} onChange={(per_page) => setParams((p) => ({ ...p, per_page, page: 1 }))} />

  const printCards = () => {
    const el = document.getElementById('fl-bulk-cards')
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!el || !w) return
    w.document.write(
      `<html><head><title>${tx('সদস্য কার্ড')}</title><style>body{font-family:sans-serif;margin:12px}.fl-cards{display:flex;flex-wrap:wrap;gap:12px}.fl-cards>div{break-inside:avoid;border:1px dashed #999;padding:10px;width:220px;text-align:center}.ant-card-head{display:none}.h{font-weight:700;font-size:14px;margin-bottom:6px}canvas,img{width:150px;height:150px}.t{font-weight:700;font-size:15px;margin-top:6px}.c{font-size:13px}.n{font-size:10px;margin-top:6px;border-top:1px solid #ccc;padding-top:4px}</style></head><body><div class="fl-cards">${[...el.querySelectorAll('[id^="qr-label-"]')].map((c) => `<div>${c.innerHTML}</div>`).join('')}</div></body></html>`,
    )
    // canvases don't survive innerHTML — copy them as images
    const src = el.querySelectorAll('[id^="qr-label-"] canvas')
    w.document.querySelectorAll('canvas').forEach((c, i) => {
      const img = w.document.createElement('img')
      img.src = (src[i] as HTMLCanvasElement).toDataURL()
      c.replaceWith(img)
    })
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  const mouzaOptions = useMemo(() => (mouzas.data ?? []).map((m) => ({ value: m.id, label: nameOf(m) })), [mouzas.data])

  return (
    // the approved design uses a blue accent on this page, whatever the brand colour
    <ConfigProvider theme={{ token: { colorPrimary: '#1769e0', colorLink: '#1769e0' } }}>
      <div className="fl">
        <nav className="fl-crumb">
          <Link to="/" aria-label={tx('ড্যাশবোর্ড')}>
            <HomeOutlined />
          </Link>
          <RightOutlined className="fl-crumb-sep" />
          <Link to="/farmers">{tx('কৃষক ও সদস্য')}</Link>
          <RightOutlined className="fl-crumb-sep" />
          <span>{tx('কৃষক তালিকা')}</span>
        </nav>
        <PageTabs />

        <div className="fl-head">
          <div>
            <h1>{tx('কৃষক')}</h1>
            <p>{tx('কৃষকের তথ্য, সদস্যপদের অবস্থা পরিচালনা করুন এবং সম্পূর্ণ বিবরণ দেখুন।')}</p>
          </div>
          <div className="fl-head-btns">
            {can('farmer.create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/farmers/new')}>
                {tx('কৃষক যোগ করুন')}
              </Button>
            )}
            {can('import.create') && (
              <Button icon={<UploadOutlined />} onClick={() => navigate('/imports?type=farmers')}>
                {tx('ইমপোর্ট')}
              </Button>
            )}
            <Button icon={<IdcardOutlined />} onClick={() => setCardsOpen(true)} disabled={!rows.length}>
              {tx('বাল্ক কার্ড')}
            </Button>
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button>
                {tx('আরও')} <DownOutlined className="fl-caret" />
              </Button>
            </Dropdown>
          </div>
        </div>

        <div className="fl-stats">
          {cards.map((c) => (
            <button
              key={c.key}
              type="button"
              className="fl-stat"
              style={{ ['--tint' as string]: c.tint }}
              onClick={() => (c.type ? navigate(`/farmers?type=${c.type}`) : c.status ? apply({ member_status: c.status }) : c.key === 'total' ? reset() : undefined)}
            >
              <span className="fl-stat-icon" style={{ background: c.tint }}>
                <DashIcon name={c.icon} size={30} color={c.color} stroke={2.1} />
              </span>
              <span className="fl-stat-body">
                <span className="fl-stat-label">{c.label}</span>
                <span className="fl-stat-row">
                  <span className="fl-stat-value">{c.value}</span>
                  {c.pill && <span className={`fl-pill ${c.tone}`}>{c.pill}</span>}
                  {c.unit && <span className="fl-stat-unit">{c.unit}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="fl-card fl-filters">
          <div className="fl-filter-row">
            <label className="fl-field fl-field-search">
              <span>{tx('খুঁজুন')}</span>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder={tx('নাম, মোবাইল, NID, সদস্য নং...')}
                value={draft.search}
                onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value || undefined }))}
                onPressEnter={() => apply()}
              />
            </label>
            <label className="fl-field">
              <span>{tx('মৌজা')}</span>
              <Select
                showSearch
                optionFilterProp="label"
                value={draft.mouza_id ?? ''}
                options={[{ value: '', label: tx('সকল মৌজা') }, ...mouzaOptions]}
                onChange={(v) => setDraft((d) => ({ ...d, mouza_id: v === '' ? undefined : Number(v) }))}
              />
            </label>
            <label className="fl-field">
              <span>{tx('সদস্য অবস্থা')}</span>
              <Select
                value={draft.member_status ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: 'active', label: tx('সক্রিয় সদস্য') },
                  { value: 'inactive', label: tx('নিষ্ক্রিয় সদস্য') },
                  { value: 'cancelled', label: tx('বাতিল সদস্য') },
                  { value: 'pending', label: tx('অপেক্ষমাণ') },
                  { value: 'non_member', label: tx('সদস্য নন') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, member_status: v || undefined }))}
              />
            </label>
            <label className="fl-field">
              <span>{tx('পেশা')}</span>
              <Select value={draft.occupation ?? ''} options={[{ value: '', label: tx('সকল') }, ...toOptions(meta?.occupations)]} onChange={(v) => setDraft((d) => ({ ...d, occupation: v || undefined }))} />
            </label>
            <label className="fl-field">
              <span>{tx('জমির মালিক?')}</span>
              <Select
                value={draft.land_owner ?? ''}
                options={[
                  { value: '', label: tx('সকল') },
                  { value: 'yes', label: tx('হ্যাঁ') },
                  { value: 'no', label: tx('না') },
                ]}
                onChange={(v) => setDraft((d) => ({ ...d, land_owner: v || undefined }))}
              />
            </label>
            <div className="fl-filter-btns">
              <Button type="primary" icon={<SearchOutlined />} onClick={() => apply()}>
                {tx('খুঁজুন')}
              </Button>
              <Button onClick={reset}>{tx('রিসেট')}</Button>
            </div>
          </div>
          {moreOpen && (
            <div className="fl-filter-row fl-filter-more">
              <label className="fl-field fl-field-loc">
                <span>{tx('এলাকা')}</span>
                <LocationCascader
                  value={path}
                  onChange={(v) => {
                    setPath(v)
                    setDraft((d) => ({ ...d, union_id: v[4] ? undefined : v[3], village_id: v[4] }))
                  }}
                />
              </label>
              <label className="fl-field">
                <span>{tx('কৃষকের অবস্থা')}</span>
                <Select
                  value={draft.is_active ?? ''}
                  options={[
                    { value: '', label: tx('সকল') },
                    { value: '1', label: tx('সক্রিয়') },
                    { value: '0', label: tx('নিষ্ক্রিয়') },
                  ]}
                  onChange={(v) => setDraft((d) => ({ ...d, is_active: v || undefined }))}
                />
              </label>
            </div>
          )}
          <button type="button" className="fl-more" onClick={() => setMoreOpen((o) => !o)}>
            {moreOpen ? tx('কম ফিল্টার') : tx('আরও ফিল্টার')} {moreOpen ? <UpOutlined /> : <DownOutlined />}
          </button>
        </div>

        <div className="fl-card fl-table-card">
          <div className="fl-table-head">
            <h3>{tx('কৃষক তালিকা ({{p0}})', { p0: n0(total) })}</h3>
            <div className="fl-table-tools">
              {can('farmer.export') && (
                <Button icon={<DownloadOutlined />} className="fl-export" onClick={exportCsv}>
                  {tx('এক্সপোর্ট')}
                </Button>
              )}
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                popupRender={() => (
                  <div className="fl-colmenu">
                    {hideable.map((c) => (
                      <Checkbox key={c.key} checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))}>
                        {c.title as string}
                      </Checkbox>
                    ))}
                  </div>
                )}
              >
                <Button icon={<InsertRowRightOutlined />}>
                  {tx('কলাম')} <DownOutlined className="fl-caret" />
                </Button>
              </Dropdown>
            </div>
          </div>

          <Table<FarmerRow>
            className="fl-table"
            rowKey="id"
            loading={isFetching}
            dataSource={rows}
            scroll={{ x: 1100 }}
            pagination={false}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]), columnWidth: 44 }}
            columns={columns}
          />

          <div className="fl-foot">
            <span className="fl-showing">{tx('{{p0}} থেকে {{p1}} দেখানো হচ্ছে, মোট {{p2}} জন কৃষক', { p0: n0(from), p1: n0(to), p2: n0(total) })}</span>
            <Pagination
              className="fl-pager"
              current={params.page}
              pageSize={params.per_page}
              total={total}
              showSizeChanger={false}
              showLessItems
              itemRender={(page, type, el) => (type === 'page' ? <a>{digits(page)}</a> : el)}
              onChange={(page) => setParams((p) => ({ ...p, page }))}
            />
            <span className="fl-rows">
              {tx('প্রতি পাতায় সারি')} {pageSizeSelect}
            </span>
          </div>
        </div>

        <Modal
          open={cardsOpen}
          onCancel={() => setCardsOpen(false)}
          title={selected.length ? tx('নির্বাচিত {{p0}} জনের কার্ড', { p0: digits(cardRows.length) }) : tx('এই পাতার {{p0}} জনের কার্ড', { p0: digits(cardRows.length) })}
          width={860}
          footer={
            <Button type="primary" icon={<PrinterOutlined />} onClick={printCards}>
              {tx('সব প্রিন্ট')}
            </Button>
          }
        >
          <div id="fl-bulk-cards" className="fl-bulk-cards">
            {cardRows.map((f) => (
              <QrLabel
                key={f.id}
                type="farmer"
                code={f.farmer_code}
                title={nameOf(f)}
                subtitle={f.member ? tx('সদস্য নং') + ' ' + digits(f.member.member_no) : f.mouza || undefined}
                heading={f.member ? society : undefined}
                note={f.member ? settings?.member_card_note : undefined}
              />
            ))}
          </div>
        </Modal>
        <DeleteFarmerModal farmer={deleting} onClose={() => setDeleting(null)} />
      </div>
    </ConfigProvider>
  )
}
