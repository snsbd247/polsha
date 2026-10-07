import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { App, Button, DatePicker, Dropdown, Form, Input, Modal, Select, Table, type TableColumnsType } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EyeOutlined,
  FileTextFilled,
  FilterFilled,
  GiftOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  WalletFilled,
} from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import type { LocationItem } from '../../lib/types'
import { nameOf, t as tx } from '../../lib/i18n'
import { billLabel, monthLabel, useWaterMeta, type WaterBill } from '../../lib/water'
import { Field, FilterCard, ListCard, num, pct, SummaryCards, useHiddenColumns, usePrint, WaterFrame } from './WaterList'

/** Every water bill — monthly, connection and reconnection fees — with what is paid and owed. */
type Bill = WaterBill & { farmer_code?: string | null }
type Totals = {
  count: number
  amount: number
  penalty: number
  paid: number
  due: number
}
type Cards = {
  total: number
  paid: number
  pending: number
  overdue: number
  amount: number
}
type Params = {
  page: number
  per_page: number
  period?: string
  status?: string
  kind?: string
  village_id?: number
  search?: string
}

const longDate = (d?: string | null) => (d ? digits(dayjs(d).format('DD MMM YYYY')) : '—')
const isOverdue = (b: Bill) => (b.status === 'unpaid' || b.status === 'partial') && !!b.due_date && dayjs(b.due_date).isBefore(dayjs(), 'day')

export default function BillsPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const first = { period: search.get('period') ?? undefined, search: search.get('search') ?? undefined }
  const [params, setParams] = useState<Params>({
    page: 1,
    per_page: 10,
    ...first,
  })
  const [draft, setDraft] = useState<Omit<Params, 'page' | 'per_page'>>(first)
  const [selected, setSelected] = useState<number[]>([])
  const [hidden, setHidden] = useHiddenColumns('polsha.water.allbills.hidden', ['penalty'])
  const [printing, print] = usePrint()
  const [viewing, setViewing] = useState<Bill | null>(null)
  const [cancelling, setCancelling] = useState<Bill | null>(null)
  const [waiving, setWaiving] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ reason: string }>()
  const { data: meta } = useWaterMeta()
  const villages = useQuery({
    queryKey: ['villages', 'all'],
    queryFn: async () =>
      (
        await api.get<LocationItem[]>('/locations/villages', {
          params: { active_only: 1 },
        })
      ).data,
  })
  const { data, isFetching } = useQuery({
    queryKey: ['water', 'bills', params],
    queryFn: async () => (await api.get<Paginated<Bill> & { totals: Totals; cards: Cards }>('/water/bills', { params })).data,
    placeholderData: keepPreviousData,
  })

  const apply = () =>
    setParams((p) => ({
      ...p,
      ...draft,
      search: draft.search?.trim() || undefined,
      page: 1,
    }))
  const reset = () => {
    setDraft({})
    setParams((p) => ({ page: 1, per_page: p.per_page }))
  }

  const t = data?.totals
  const c = data?.cards
  const billed = (t?.amount ?? 0) + (t?.penalty ?? 0)
  const scope = params.period ? monthLabel(params.period) : tx('সব মাস')
  const cards = [
    {
      key: 'count',
      tone: 'blue' as const,
      icon: <FileTextFilled />,
      label: tx('বিলের সংখ্যা'),
      value: num(t?.count),
      sub: scope,
    },
    {
      key: 'billed',
      tone: 'purple' as const,
      icon: <span className="wcl-taka">৳</span>,
      label: tx('বিলের টাকা'),
      value: `৳ ${num(billed)}`,
      sub: tx('জরিমানাসহ'),
    },
    {
      key: 'paid',
      tone: 'green' as const,
      icon: <CheckCircleOutlined />,
      label: tx('আদায়'),
      value: `৳ ${num(t?.paid)}`,
      sub: tx('বিলের {{p0}}', { p0: pct(t?.paid ?? 0, billed) }),
    },
    {
      key: 'due',
      tone: 'red' as const,
      icon: <WalletFilled />,
      label: tx('বকেয়া'),
      value: `৳ ${num(t?.due)}`,
      sub: tx('বিলের {{p0}}', { p0: pct(t?.due ?? 0, billed) }),
    },
    {
      key: 'overdue',
      tone: 'orange' as const,
      icon: <StopOutlined />,
      label: tx('মেয়াদোত্তীর্ণ বিল'),
      value: num(c?.overdue),
      sub: tx('শেষ তারিখ পার হয়েছে'),
    },
  ]

  const statusTag = (b: Bill) => {
    if (b.status === 'paid') return <span className="wcl-tag wcl-tag-green">{meta?.bill_statuses.paid ?? b.status}</span>
    if (b.status === 'cancelled') return <span className="wcl-tag wcl-tag-grey">{meta?.bill_statuses.cancelled ?? b.status}</span>
    if (isOverdue(b)) return <span className="wcl-tag wcl-tag-red">{tx('মেয়াদোত্তীর্ণ')}</span>
    return <span className="wcl-tag wcl-tag-amber">{b.status === 'partial' ? (meta?.bill_statuses.partial ?? b.status) : tx('অপেক্ষমাণ')}</span>
  }

  const allColumns: (TableColumnsType<Bill>[number] & {
    key: string
    fixedCol?: boolean
  })[] = [
    {
      key: 'sl',
      title: '#',
      width: 48,
      fixedCol: true,
      render: (_, __, i) => digits((params.page - 1) * params.per_page + i + 1),
    },
    {
      key: 'bill_no',
      title: tx('বিল নং'),
      dataIndex: 'bill_no',
      width: 140,
      fixedCol: true,
      render: (v: string) => digits(v),
    },
    {
      key: 'kind',
      title: tx('কিসের বিল'),
      width: 120,
      render: (_, b) => <span title={billLabel(b)}>{b.kind === 'monthly' ? monthLabel(b.period) : billLabel(b)}</span>,
    },
    {
      key: 'name',
      title: tx('গ্রাহকের নাম'),
      width: 140,
      render: (_, b) => (
        <Link to={`/water/connections/${b.connection_id}`} className="wcl-plain-link" title={nameOf(b.snapshot)}>
          {nameOf(b.snapshot)}
        </Link>
      ),
    },
    {
      key: 'connection_no',
      title: tx('সংযোগ নং'),
      width: 106,
      render: (_, b) => digits(b.snapshot.connection_no),
    },
    {
      key: 'bill_date',
      title: tx('বিলের তারিখ'),
      dataIndex: 'bill_date',
      width: 108,
      render: longDate,
    },
    {
      key: 'amount',
      title: tx('বিল (৳)'),
      width: 88,
      align: 'right',
      render: (_, b) => money(b.amount),
    },
    {
      key: 'penalty',
      title: tx('জরিমানা'),
      width: 82,
      align: 'right',
      render: (_, b) => (b.penalty ? money(b.penalty) : '—'),
    },
    {
      key: 'paid',
      title: tx('আদায়'),
      width: 88,
      align: 'right',
      render: (_, b) => money(b.paid_amount),
    },
    {
      key: 'due',
      title: tx('বকেয়া'),
      width: 88,
      align: 'right',
      render: (_, b) => (b.due > 0 ? <strong className="wcl-due">{money(b.due)}</strong> : <span className="wcl-muted">{money(0)}</span>),
    },
    {
      key: 'status',
      title: tx('অবস্থা'),
      width: 100,
      render: (_, b) => statusTag(b),
    },
    {
      key: 'action',
      title: tx('কাজ'),
      width: 132,
      fixedCol: true,
      className: 'wcl-no-print wcl-actcol',
      render: (_, b) => {
        const canCollect = can('water.create') && b.due > 0
        return (
          <span className="wcl-acts">
            <button type="button" className="wcl-act" aria-label={tx('বিস্তারিত')} title={tx('বিস্তারিত')} onClick={() => setViewing(b)}>
              <EyeOutlined />
            </button>
            <button
              type="button"
              className="wcl-act wcl-act-edit"
              aria-label={tx('টাকা আদায়')}
              title={canCollect ? tx('টাকা আদায়') : tx('আদায়ের কিছু নেই')}
              disabled={!canCollect}
              onClick={() => navigate(`/water/collect?connection=${b.connection_id}`)}
            >
              <DollarOutlined />
            </button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  {
                    key: 'view',
                    icon: <EyeOutlined />,
                    label: tx('বিলের বিস্তারিত'),
                    onClick: () => setViewing(b),
                  },
                  {
                    key: 'connection',
                    icon: <FileTextFilled />,
                    label: tx('সংযোগের পাতা'),
                    onClick: () => navigate(`/water/connections/${b.connection_id}`),
                  },
                  ...(can('water.approve') && b.penalty > 0 && b.due > 0
                    ? [
                        {
                          key: 'waive',
                          icon: <GiftOutlined />,
                          label: tx('জরিমানা মওকুফ'),
                          onClick: () => (form.resetFields(), setWaiving(b)),
                        },
                      ]
                    : []),
                  ...(can('water.edit') && b.status === 'unpaid' && b.paid_amount === 0
                    ? [
                        {
                          key: 'cancel',
                          icon: <CloseCircleOutlined />,
                          danger: true,
                          label: tx('বাতিলের অনুরোধ'),
                          onClick: () => (form.resetFields(), setCancelling(b)),
                        },
                      ]
                    : []),
                ],
              }}
            >
              <button type="button" className="wcl-act" aria-label={tx('আরও')}>
                <MoreOutlined />
              </button>
            </Dropdown>
          </span>
        )
      },
    },
  ]
  const columns = allColumns.filter((col) => !hidden.includes(col.key))
  const rows = useMemo(() => {
    const all = data?.data ?? []
    return printing && selected.length ? all.filter((r) => selected.includes(r.id)) : all
  }, [data, printing, selected])

  const sendReason = async ({ reason }: { reason: string }) => {
    setBusy(true)
    try {
      if (cancelling) {
        await api.post(`/water/bills/${cancelling.id}/cancel`, { reason })
        message.success(tx('বাতিলের অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'))
      } else if (waiving) {
        await api.post(`/water/bills/${waiving.id}/waive-penalty`, { reason })
        message.success(tx('জরিমানা মওকুফ হয়েছে।'))
      }
      setCancelling(null)
      setWaiving(null)
      queryClient.invalidateQueries({ queryKey: ['water'] })
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WaterFrame crumbs={[{ label: tx('পানি সরবরাহ') }, { label: tx('পানির বিল') }]}>
      <SummaryCards cards={cards} />

      <FilterCard
        className="wcl-filters-5"
        title={
          <>
            <FilterFilled /> {tx('ফিল্টার ও খোঁজ')}
          </>
        }
        onSearch={apply}
        onReset={reset}
      >
        <Field label={tx('খুঁজুন')} wide>
          <Input
            prefix={<SearchOutlined />}
            placeholder={tx('বিল নং, নাম, মোবাইল বা সংযোগ নং...')}
            allowClear
            value={draft.search}
            onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
            onPressEnter={apply}
          />
        </Field>
        <Field label={tx('বিলের মাস')}>
          <DatePicker
            picker="month"
            placeholder={tx('সব মাস')}
            value={draft.period ? dayjs(`${draft.period}-01`) : null}
            format={(d) => monthLabel(d.format('YYYY-MM'))}
            onChange={(d) =>
              setDraft((x) => ({
                ...x,
                period: d ? d.format('YYYY-MM') : undefined,
              }))
            }
          />
        </Field>
        <Field label={tx('পরিশোধের অবস্থা')}>
          <Select
            value={draft.status ?? ''}
            options={[
              { value: '', label: tx('সব অবস্থা') },
              { value: 'open', label: tx('বকেয়া (অপরিশোধিত + আংশিক)') },
              { value: 'paid', label: tx('পরিশোধিত') },
              { value: 'pending', label: tx('অপেক্ষমাণ') },
              { value: 'overdue', label: tx('মেয়াদোত্তীর্ণ') },
              {
                value: 'partial',
                label: meta?.bill_statuses.partial ?? tx('আংশিক'),
              },
              {
                value: 'cancelled',
                label: meta?.bill_statuses.cancelled ?? tx('বাতিল'),
              },
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, status: v || undefined }))}
          />
        </Field>
        <Field label={tx('কিসের বিল')}>
          <Select
            value={draft.kind ?? ''}
            options={[
              { value: '', label: tx('সব ধরনের বিল') },
              ...Object.entries(meta?.kinds ?? {}).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, kind: v || undefined }))}
          />
        </Field>
        <Field label={tx('এলাকা / গ্রাম')}>
          <Select
            value={draft.village_id ?? 0}
            showSearch={{ optionFilterProp: 'label' }}
            options={[
              { value: 0, label: tx('সব এলাকা') },
              ...(villages.data ?? []).map((v) => ({
                value: v.id,
                label: nameOf(v),
              })),
            ]}
            onChange={(v) => setDraft((d) => ({ ...d, village_id: v || undefined }))}
          />
        </Field>
      </FilterCard>

      <ListCard
        title={
          <>
            <FileTextFilled /> {tx('পানির বিলের তালিকা')}
          </>
        }
        actions={
          can('water.create') && (
            <Button type="primary" icon={<PlusOutlined />} className="wcl-no-print" onClick={() => navigate('/water/billing')}>
              {tx('মাসিক বিল তৈরি করুন')}
            </Button>
          )
        }
        selectedCount={selected.length}
        onExport={() =>
          downloadExport(
            '/water/bills',
            {
              ...params,
              page: undefined,
              per_page: undefined,
              ids: selected.length ? selected.join(',') : undefined,
              export: 'csv',
            },
            'water-bills.csv',
          ).catch((e) => message.error(errorMessage(e)))
        }
        onPrint={print}
        columns={allColumns.filter((col) => !col.fixedCol).map((col) => ({ key: col.key, title: col.title as ReactNode }))}
        hidden={hidden}
        setHidden={setHidden}
        pager={{
          page: params.page,
          perPage: params.per_page,
          total: data?.total ?? 0,
          onPage: (page) => setParams((p) => ({ ...p, page })),
          onSize: (per_page) => setParams((p) => ({ ...p, per_page, page: 1 })),
        }}
      >
        <Table<Bill>
          className="wcl-table"
          rowKey="id"
          loading={isFetching}
          dataSource={rows}
          tableLayout="fixed"
          scroll={{ x: 1180 }}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as number[]),
            columnWidth: 44,
            preserveSelectedRowKeys: true,
          }}
          columns={columns}
        />
      </ListCard>

      <Modal open={!!viewing} title={viewing ? `${tx('বিল')} ${digits(viewing.bill_no)}` : ''} footer={null} onCancel={() => setViewing(null)} destroyOnHidden>
        {viewing && (
          <dl className="wcl-kv">
            {(
              [
                [tx('গ্রাহক'), nameOf(viewing.snapshot)],
                [tx('সংযোগ নং'), digits(viewing.snapshot.connection_no)],
                [tx('কিসের বিল'), billLabel(viewing)],
                [tx('বিলের তারিখ'), longDate(viewing.bill_date)],
                [tx('শেষ তারিখ'), longDate(viewing.due_date)],
                [tx('বিল'), `৳ ${money(viewing.amount)}`],
                [tx('জরিমানা'), `৳ ${money(viewing.penalty)}`],
                [tx('আদায়'), `৳ ${money(viewing.paid_amount)}`],
                [tx('বকেয়া'), `৳ ${money(viewing.due)}`],
                [tx('অবস্থা'), statusTag(viewing)],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>

      <Modal
        open={!!cancelling || !!waiving}
        title={
          cancelling
            ? tx('বিল বাতিলের অনুরোধ — {{p0}}', {
                p0: digits(cancelling.bill_no),
              })
            : tx('জরিমানা মওকুফ — {{p0}}', {
                p0: digits(waiving?.bill_no ?? ''),
              })
        }
        onCancel={() => {
          setCancelling(null)
          setWaiving(null)
        }}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText={cancelling ? tx('অনুমোদনের জন্য পাঠান') : tx('মওকুফ করুন')}
        destroyOnHidden
      >
        <p className="wcl-modal-note">
          {cancelling
            ? tx('ম্যানেজার অনুমোদন দিলে বিল বাতিল হবে ও হিসাবের খাতায় উল্টো এন্ট্রি হবে।')
            : tx('এই বিলে অপরিশোধিত জরিমানা ৳{{p0}} মওকুফ হবে; আগে আদায় হওয়া টাকা বদলাবে না।', {
                p0: money(Math.min(waiving?.penalty ?? 0, waiving?.due ?? 0)),
              })}
        </p>
        <Form form={form} layout="vertical" onFinish={sendReason}>
          <Form.Item name="reason" label={tx('কারণ')} rules={[{ required: true, message: tx('কারণ লিখুন') }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </WaterFrame>
  )
}
