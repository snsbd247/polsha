import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Dropdown, Popconfirm, Result, Spin, Table, Tabs, Tag } from 'antd'
import {
  AppstoreFilled,
  ArrowLeftOutlined,
  BankFilled,
  CalendarFilled,
  CheckCircleFilled,
  DollarCircleFilled,
  DownOutlined,
  EditOutlined,
  EnvironmentFilled,
  FallOutlined,
  HistoryOutlined,
  StopOutlined,
  SwapOutlined,
  ToolOutlined,
  WalletFilled,
} from '@ant-design/icons'
import PageFrame from '../../components/PageFrame'
import QrLabel from '../../components/QrLabel'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage } from '../../lib/api'
import { accountLabel, money, moneyOrBlank } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import { METHOD_LABEL } from '../../lib/irrigation'
import { ASSET_TONE, CONDITION_TONE, MAINT_TONE, MOVE_TONE, useAssetMeta } from '../../lib/phase8'
import { nameOf, t as tx } from '../../lib/i18n'
import dayjs from 'dayjs'
import { Box, Fact, KV } from '../irrigation/InvoiceDetailPage'
import { ALLOWED, CompleteModal, DisposeModal, LIVE, MOVE_LABEL, MovementModal, ScheduleModal, journalLink, type Depreciation, type Detail, type Maintenance, type Movement, type MoveType } from './AssetModals'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../lands/land-list.css'
import '../loans/loans.css'
import './assets.css'

/** One asset: its value, where it is and who holds it, its QR label, and its movement / service / depreciation history. */
export default function AssetDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const meta = useAssetMeta()
  const [move, setMove] = useState<MoveType | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [completing, setCompleting] = useState<Maintenance | null>(null)
  // finishing a repair from the top button also brings the asset back from repair
  const [finishing, setFinishing] = useState(false)
  const [disposing, setDisposing] = useState(false)
  const { message } = App.useApp()
  const { data: a, isLoading, isError } = useQuery({ queryKey: ['asset', id], queryFn: async () => (await api.get<Detail>(`/assets/${id}`)).data, retry: false })

  const refresh = () => {
    for (const k of ['asset', 'assets', 'asset-maintenances', 'asset-movements', 'asset-dashboard']) queryClient.invalidateQueries({ queryKey: [k] })
  }
  const cancelJob = async (m: Maintenance) => {
    try {
      await api.post(`/assets/maintenances/${m.id}/cancel`)
      message.success(tx('বাতিল হয়েছে।'))
      refresh()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  if (isError) return <Result status="404" title={tx('সম্পদটি পাওয়া যায়নি')} extra={<Button onClick={() => navigate('/assets')}>{tx('তালিকায় ফিরুন')}</Button>} />
  if (isLoading || !a) return <Spin style={{ display: 'block', marginTop: 64 }} />
  const live = LIVE.includes(a.status)
  const canJournal = can('accounting.view')
  const moves = (Object.keys(ALLOWED) as MoveType[]).filter((t) => ALLOWED[t].includes(a.status))
  const paid = [a.method ? (METHOD_LABEL[a.method] ?? (a.method === 'credit' ? tx('বাকিতে') : a.method)) : '', a.fund ? accountLabel(a.fund) : '', a.reference ? digits(a.reference) : ''].filter(Boolean).join(' — ')
  const base = Number(a.cost) - Number(a.salvage_value)
  const usedPct = base > 0 ? Math.min(100, Math.round((Number(a.accumulated_depreciation) / base) * 100)) : 0

  return (
    <PageFrame
      className="id-page ln-page"
      crumbs={[{ label: tx('সম্পদ'), to: '/assets/dashboard' }, { label: tx('সম্পদ রেজিস্টার'), to: '/assets' }, { label: tx('সম্পদের বিস্তারিত') }]}
      title={tx('সম্পদের বিস্তারিত')}
      actions={
        <span className="id-actions">
          {live && can('asset.edit') && (
            <>
              {/* the everyday moves as buttons, the rest under "more" */}
              {moves.includes('repaired') && (
                <Button
                  type="primary"
                  icon={<ToolOutlined />}
                  onClick={() => {
                    const job = a.maintenances.find((m) => m.kind === 'repair' && m.status === 'scheduled')
                    if (job) {
                      setFinishing(true)
                      setCompleting(job)
                    } else setMove('repaired')
                  }}
                >
                  {MOVE_LABEL.repaired}
                </Button>
              )}
              {moves.includes('transfer') && (
                <Button type="primary" icon={<SwapOutlined />} onClick={() => setMove('transfer')}>
                  {MOVE_LABEL.transfer}
                </Button>
              )}
              {moves.includes('repair') && (
                <Button icon={<ToolOutlined />} className="fm-history-btn" onClick={() => setMove('repair')}>
                  {MOVE_LABEL.repair}
                </Button>
              )}
              {moves.some((t) => !['transfer', 'repair', 'repaired'].includes(t)) && (
                <Dropdown trigger={['click']} menu={{ items: moves.filter((t) => !['transfer', 'repair', 'repaired'].includes(t)).map((t) => ({ key: t, label: MOVE_LABEL[t], onClick: () => setMove(t) })) }}>
                  <Button className="fm-history-btn">
                    {tx('আরও')} <DownOutlined />
                  </Button>
                </Dropdown>
              )}
              <Button icon={<ToolOutlined />} className="fm-history-btn" onClick={() => setScheduling(true)}>
                {tx('সার্ভিস/মেরামত নির্ধারণ')}
              </Button>
              <Button danger icon={<StopOutlined />} onClick={() => setDisposing(true)}>
                {tx('বিক্রয় / বাতিল')}
              </Button>
            </>
          )}
          {can('asset.edit') && (
            <Button icon={<EditOutlined />} className="fm-history-btn" onClick={() => navigate(`/assets/${a.id}/edit`)}>
              {tx('সম্পাদনা')}
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} className="fm-history-btn" onClick={() => navigate('/assets')}>
            {tx('তালিকায় ফিরুন')}
          </Button>
        </span>
      }
    >
      {a.status === 'disposal_pending' && <Alert className="id-alert" type="warning" showIcon title={tx('বিক্রয়/বাতিলের আবেদন অনুমোদনের অপেক্ষায় আছে। অনুমোদন তালিকা থেকে সিদ্ধান্ত দিন।')} />}
      {a.disposal && a.status !== 'disposal_pending' && (
        <Alert
          className="id-alert"
          type="info"
          showIcon
          title={tx('{{p0}} — {{p1}}, মূল্য ৳{{p2}}। কারণ: {{p3}}', { p0: meta.data?.statuses[a.status] ?? a.status, p1: fmtDate(a.disposal.date), p2: money(a.disposal.price), p3: a.disposal.reason })}
        />
      )}

      <div className="id-top">
        <div className="id-hero">
          <span className="id-hero-icon">
            <AppstoreFilled />
          </span>
          <div>
            <small>{digits(a.asset_code)}</small>
            <strong>{nameOf(a)}</strong>
            <Tag className={`fl-tag ${ASSET_TONE[a.status] ?? 'll-gray'}`}>● {meta.data?.statuses[a.status] ?? a.status}</Tag>
          </div>
        </div>
        <Fact icon={<DollarCircleFilled />} label={tx('ক্রয়মূল্য')} color="#8b3fe0" tint="#efe4fc">
          <strong>৳ {money(a.cost)}</strong>
        </Fact>
        <Fact icon={<FallOutlined />} label={tx('পুঞ্জীভূত অবচয় · {{p0}}%', { p0: digits(usedPct) })} color="#e5383b" tint="#fde4e5">
          <strong>৳ {money(a.accumulated_depreciation)}</strong>
        </Fact>
        <Fact icon={<WalletFilled />} label={tx('বর্তমান মূল্য')} color="#1f9d55" tint="#dcf3e5">
          <strong>৳ {money(a.book_value)}</strong>
        </Fact>
        <Fact icon={<CalendarFilled />} label={live ? tx('মাসিক অবচয় · বাকি {{p0}} মাস', { p0: digits(a.months_left) }) : tx('মাসিক অবচয়')} color="#1769e0" tint="#e4edfd">
          <strong>৳ {money(a.monthly_charge)}</strong>
        </Fact>
      </div>

      <div className="as-info">
        <Box icon={<AppstoreFilled />} title={tx('সম্পদের তথ্য')}>
          <KV
            rows={[
              [tx('শ্রেণি'), nameOf(a.category) || '—'],
              [tx('ব্র্যান্ড / মডেল'), a.brand_model || '—'],
              [tx('সিরিয়াল নম্বর'), a.serial_no ? digits(a.serial_no) : '—'],
              [tx('সরবরাহকারী'), a.supplier || '—'],
              [tx('অর্জনের ধরন'), meta.data?.acquisitions[a.acquisition] ?? a.acquisition],
              [tx('ক্রয়ের তারিখ'), fmtDate(a.purchase_date)],
              [tx('পরিশোধ'), paid || '—'],
              [tx('ভাউচার'), journalLink(a.journal, canJournal) ?? '—'],
            ]}
          />
        </Box>
        <Box icon={<EnvironmentFilled />} title={tx('অবস্থান ও অবচয়')}>
          <KV
            rows={[
              [tx('অবস্থান'), `${a.location ?? '—'}${a.mouza ? ` (${nameOf(a.mouza)})` : ''}`],
              [tx('দায়িত্বপ্রাপ্ত'), a.custodian || '—'],
              [tx('ভৌত অবস্থা'), a.condition ? <Tag className={`fl-tag ${CONDITION_TONE[a.condition] ?? 'll-gray'}`}>{meta.data?.conditions[a.condition] ?? a.condition}</Tag> : '—'],
              [tx('স্থাপনের তারিখ'), a.installed_on ? fmtDate(a.installed_on) : '—'],
              [tx('আয়ুষ্কাল'), tx('{{p0}} মাস', { p0: digits(a.life_months) })],
              [tx('অবশিষ্ট মূল্য'), `৳ ${money(a.salvage_value)}`],
              [tx('অবচয় শুরু'), fmtDate(a.depreciation_from)],
              [tx('এন্ট্রি করেছেন'), nameOf(a.creator) || '—'],
            ]}
          />
          {a.remarks && <p className="as-remarks">{a.remarks}</p>}
        </Box>
        <div className="as-qr">
          <QrLabel type="asset" code={a.asset_code} title={nameOf(a)} subtitle={nameOf(a.category) || undefined} />
        </div>
      </div>

      <Box icon={<HistoryOutlined />} title={tx('ইতিহাস')} className="ln-tabs-box">
        <Tabs
          className="ln-tabs"
          items={[
            {
              key: 'movements',
              label: tx('চলাচলের ইতিহাস ({{p0}})', { p0: digits(a.movements.length) }),
              children: (
                <Table<Movement>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={a.movements}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
                    { title: tx('ধরন'), dataIndex: 'type', render: (v: string) => <Tag className={`fl-tag ${MOVE_TONE[v] ?? 'll-gray'}`}>{meta.data?.movement_types[v] ?? v}</Tag> },
                    { title: tx('থেকে'), dataIndex: 'from_location', render: (v: string | null) => v || '—' },
                    { title: tx('যেখানে'), dataIndex: 'to_location', render: (v: string | null) => v || '—' },
                    { title: tx('দায়িত্বপ্রাপ্ত'), dataIndex: 'custodian', render: (v: string | null) => v || '—' },
                    { title: tx('অবস্থা'), dataIndex: 'condition', render: (v: string | null) => (v ? (meta.data?.conditions[v] ?? v) : '—') },
                    { title: tx('টাকা (৳)'), dataIndex: 'amount', align: 'right', render: moneyOrBlank },
                    { title: tx('নোট'), dataIndex: 'note', render: (v: string | null) => v || '—' },
                    { title: tx('ভাউচার'), render: (_, m) => journalLink(m.journal, canJournal) ?? '—' },
                    { title: tx('করেছেন'), render: (_, m) => nameOf(m.creator) || '—' },
                  ]}
                />
              ),
            },
            {
              key: 'maintenance',
              label: tx('সার্ভিস ও মেরামত ({{p0}})', { p0: digits(a.maintenances.length) }),
              children: (
                <Table<Maintenance>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={a.maintenances}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: tx('কোনো কাজ নির্ধারিত নেই') }}
                  columns={[
                    { title: tx('ধরন'), dataIndex: 'kind', render: (v: string) => meta.data?.maintenance_kinds[v] ?? v },
                    { title: tx('কাজ'), dataIndex: 'title' },
                    { title: tx('নির্ধারিত তারিখ'), dataIndex: 'due_on', render: (v: string | null) => fmtDate(v) || '—' },
                    { title: tx('সম্পন্ন'), dataIndex: 'done_on', render: (v: string | null) => fmtDate(v) || '—' },
                    { title: tx('খরচ (৳)'), dataIndex: 'cost', align: 'right', render: moneyOrBlank },
                    { title: tx('ভাউচার'), render: (_, m) => journalLink(m.journal, canJournal) ?? '—' },
                    { title: tx('স্ট্যাটাস'), dataIndex: 'status', render: (v: string) => <Tag className={`fl-tag ${MAINT_TONE[v] ?? 'll-gray'}`}>{meta.data?.maintenance_statuses[v] ?? v}</Tag> },
                    {
                      title: tx('অ্যাকশন'),
                      render: (_, m) =>
                        m.status === 'scheduled' && can('asset.edit') ? (
                          <span className="as-row-acts">
                            <Button size="small" type="primary" icon={<CheckCircleFilled />} onClick={() => setCompleting(m)}>
                              {tx('সম্পন্ন')}
                            </Button>
                            <Popconfirm title={tx('এই কাজ বাতিল করবেন?')} onConfirm={() => cancelJob(m)}>
                              <Button size="small">{tx('বাতিল')}</Button>
                            </Popconfirm>
                          </span>
                        ) : null,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'depreciation',
              label: tx('অবচয় ({{p0}})', { p0: digits(a.depreciations.length) }),
              children: (
                <Table<Depreciation>
                  rowKey="id"
                  size="small"
                  className="id-payments"
                  dataSource={a.depreciations}
                  pagination={{ pageSize: 12, hideOnSinglePage: true }}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: tx('এখনও অবচয় চালানো হয়নি') }}
                  columns={[
                    { title: tx('মাস'), dataIndex: 'period', render: (v: string) => digits(v) },
                    { title: tx('অবচয় (৳)'), dataIndex: 'amount', align: 'right', render: money },
                    { title: tx('পুঞ্জীভূত (৳)'), dataIndex: 'accumulated_after', align: 'right', render: money },
                    { title: tx('বর্তমান মূল্য (৳)'), dataIndex: 'book_value_after', align: 'right', render: (v: string) => <strong>{money(v)}</strong> },
                    { title: tx('ভাউচার'), render: (_, d) => journalLink(d.journal, canJournal) ?? '—' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Box>

      {canJournal && a.fund && (
        <p className="as-foot">
          <BankFilled /> {tx('পরিশোধের হিসাব')}: <Link to={`/accounting/ledger?account_id=${a.fund.id}`}>{accountLabel(a.fund)}</Link>
        </p>
      )}

      <MovementModal asset={a} type={move} onClose={() => setMove(null)} onDone={refresh} />
      <ScheduleModal asset={a} open={scheduling} onClose={() => setScheduling(false)} onDone={refresh} />
      <CompleteModal
        job={completing}
        onClose={() => {
          setCompleting(null)
          setFinishing(false)
        }}
        onDone={async () => {
          if (finishing && a.status === 'in_repair') {
            await api.post(`/assets/${a.id}/movements`, { type: 'repaired', date: dayjs().format('YYYY-MM-DD'), note: tx('মেরামত শেষে ফেরত এসেছে') }).catch((e) => message.error(errorMessage(e)))
          }
          setFinishing(false)
          refresh()
        }}
      />
      <DisposeModal asset={a} open={disposing} onClose={() => setDisposing(false)} onDone={refresh} />
    </PageFrame>
  )
}
