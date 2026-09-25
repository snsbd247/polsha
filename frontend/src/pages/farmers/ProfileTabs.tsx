import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Upload } from 'antd'
import { FilePdfOutlined, UploadOutlined } from '@ant-design/icons'
import { useAuth } from '../../auth/AuthContext'
import AuditLogTable from '../../components/AuditLogTable'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { money } from '../../lib/accounting'
import { digits, fmtBytes, fmtDate } from '../../lib/format'
import { TXN_STATUS_COLOR, useFundMeta, type FundKind, type FundTxn } from '../../lib/funds'
import { METHOD_LABEL, RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL } from '../../lib/irrigation'
import { LOAN_STATUS_COLOR, useLoanMeta, type LoanRow } from '../../lib/loans'
import { openProtectedFile, toOptions, useFarmerMeta } from '../../lib/phase2'
import type { AuditLog } from '../../lib/types'
import { t as tx } from '../../lib/i18n'
import { StatementTables, type Statement } from '../irrigation/FarmerStatementPage'

export type Doc = { id: number; type: string; original_name: string; size: number; remarks: string | null; created_at: string; uploader: { name_bn: string } | null }

export const isImage = (d: Doc) => /\.(jpe?g|png|gif|webp)$/i.test(d.original_name)

export function useDocuments(farmerId: number) {
  return useQuery({
    queryKey: ['farmers', farmerId, 'documents'],
    queryFn: async () => (await api.get<Doc[]>(`/farmers/${farmerId}/documents`)).data,
  })
}

/** Thumbnail of an uploaded document (images are fetched with the token; PDFs show an icon). */
export function DocThumb({ farmerId, doc }: { farmerId: number; doc: Doc }) {
  const [src, setSrc] = useState<string>()
  const image = isImage(doc)
  useEffect(() => {
    if (!image) return
    let url: string | undefined
    let cancelled = false
    api
      .get(`/farmers/${farmerId}/documents/${doc.id}`, { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        url = URL.createObjectURL(r.data)
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [farmerId, doc.id, image])
  return <div className="fp-thumb">{image ? src && <img src={src} alt={doc.original_name} /> : <FilePdfOutlined className="fp-thumb-icon" />}</div>
}

/** Upload dialog shared by the documents card and the documents tab. */
export function UploadDocModal({ farmerId, open, onClose }: { farmerId: number; open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useFarmerMeta()
  const [form] = Form.useForm()
  const [file, setFile] = useState<File | null>(null)

  const upload = async () => {
    const v = await form.validateFields()
    if (!file) {
      message.error(tx('ফাইল বাছাই করুন।'))
      return
    }
    const fd = new FormData()
    fd.append('type', v.type)
    fd.append('file', file)
    if (v.remarks) fd.append('remarks', v.remarks)
    try {
      await api.post(`/farmers/${farmerId}/documents`, fd)
      message.success(tx('আপলোড হয়েছে।'))
      onClose()
      setFile(null)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['farmers', farmerId, 'documents'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <Modal open={open} title={tx('ডকুমেন্ট আপলোড')} onCancel={onClose} onOk={upload} okText={tx('আপলোড')} cancelText={tx('বাতিল')} forceRender>
      <Form form={form} layout="vertical">
        <Form.Item name="type" label={tx('ধরন')} rules={[{ required: true, message: tx('ধরন দিন') }]}>
          <Select options={toOptions(meta?.document_types)} />
        </Form.Item>
        <Form.Item label={tx('ফাইল (JPG, PNG বা PDF; সর্বোচ্চ ৫MB)')} required>
          <Upload accept=".jpg,.jpeg,.png,.pdf" maxCount={1} beforeUpload={(f) => (setFile(f), false)} onRemove={() => setFile(null)}>
            <Button icon={<UploadOutlined />}>{tx('ফাইল বাছাই')}</Button>
          </Upload>
        </Form.Item>
        <Form.Item name="remarks" label={tx('মন্তব্য')}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function useRemoveDoc(farmerId: number) {
  const { modal } = App.useApp()
  const queryClient = useQueryClient()
  return (d: Doc) =>
    modal.confirm({
      title: tx('ডকুমেন্ট মুছবেন?'),
      okText: tx('মুছুন'),
      okButtonProps: { danger: true },
      cancelText: tx('না'),
      onOk: async () => {
        await api.delete(`/farmers/${farmerId}/documents/${d.id}`)
        queryClient.invalidateQueries({ queryKey: ['farmers', farmerId, 'documents'] })
      },
    })
}

export function DocumentsTab({ farmerId }: { farmerId: number }) {
  const { can } = useAuth()
  const { message } = App.useApp()
  const { data: meta } = useFarmerMeta()
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useDocuments(farmerId)
  const remove = useRemoveDoc(farmerId)

  return (
    <>
      {can('farmer.edit') && (
        <Button icon={<UploadOutlined />} style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
          {tx('ডকুমেন্ট আপলোড')}
        </Button>
      )}
      <Table<Doc>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 600 }}
        locale={{ emptyText: tx('কোনো ডকুমেন্ট নেই') }}
        columns={[
          { title: tx('ধরন'), dataIndex: 'type', render: (t) => meta?.document_types[t] ?? t },
          { title: tx('ফাইল'), dataIndex: 'original_name' },
          { title: tx('আকার'), dataIndex: 'size', render: fmtBytes },
          { title: tx('আপলোড'), render: (_, d) => `${d.uploader?.name_bn ?? ''} · ${fmtDate(d.created_at)}` },
          {
            title: '',
            render: (_, d) => (
              <Space>
                <Button size="small" onClick={() => openProtectedFile(`/farmers/${farmerId}/documents/${d.id}`).catch((e) => message.error(errorMessage(e)))}>
                  {tx('দেখুন')}
                </Button>
                {can('farmer.edit') && (
                  <Button size="small" danger onClick={() => remove(d)}>
                    {tx('মুছুন')}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <UploadDocModal farmerId={farmerId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function HistoryTab({ farmerId }: { farmerId: number }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useQuery({
    queryKey: ['farmers', farmerId, 'history', page],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(`/farmers/${farmerId}/history`, { params: { page } })).data,
    placeholderData: keepPreviousData,
  })
  return <AuditLogTable data={data} loading={isFetching} page={page} onPage={setPage} />
}

export function IrrigationTab({ farmerId }: { farmerId: number }) {
  const { data } = useQuery({
    queryKey: ['irrigation-statement', String(farmerId)],
    queryFn: async () => (await api.get<Statement>(`/irrigation/farmers/${farmerId}/statement`)).data,
  })
  if (!data) return <Spin />
  return (
    <>
      <div className="fp-tab-link">
        <Link to={`/irrigation/farmers/${farmerId}/statement`}>{tx('পূর্ণ সেচ বিবরণী')}</Link>
      </div>
      <StatementTables data={data} />
    </>
  )
}

/** Savings or share transactions of the member's account. */
export function FundTab({ kind, accountId }: { kind: FundKind; accountId: number | null | undefined }) {
  const [page, setPage] = useState(1)
  const { data: meta } = useFundMeta(kind)
  const { data, isFetching } = useQuery({
    queryKey: ['fund-txns', kind, accountId, page],
    queryFn: async () => (await api.get<Paginated<FundTxn>>(`/funds/${kind}/transactions`, { params: { member_account_id: accountId, page, per_page: 10 } })).data,
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  })
  if (!accountId) return <Empty description={kind === 'savings' ? tx('সঞ্চয় হিসাব নেই') : tx('শেয়ার হিসাব নেই')} />
  return (
    <>
      <div className="fp-tab-link">
        <Link to={`/funds/${kind}/accounts/${accountId}`}>{tx('হিসাবের বিস্তারিত')}</Link>
      </div>
      <Table<FundTxn>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data?.data}
        scroll={{ x: 700 }}
        pagination={{ current: page, pageSize: 10, total: data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: tx('লেনদেন নং'), dataIndex: 'txn_no', render: (v, r) => <Link to={`/funds/${kind}/transactions/${r.id}`}>{digits(v)}</Link> },
          { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
          { title: tx('ধরন'), dataIndex: 'type', render: (v) => meta?.types[v] ?? v },
          { title: tx('জমার পরিমাণ'), align: 'right', render: (_, r) => (r.direction === 'in' ? money(r.amount) : '') },
          { title: tx('উত্তোলন'), align: 'right', render: (_, r) => (r.direction === 'out' ? money(r.amount) : '') },
          { title: tx('জের'), dataIndex: 'balance_after', align: 'right', render: (v) => (v == null ? '—' : money(v)) },
          { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag color={TXN_STATUS_COLOR[s]}>{meta?.statuses[s] ?? s}</Tag> },
        ]}
      />
    </>
  )
}

export function LoansTab({ memberId }: { memberId: number | undefined }) {
  const { data: meta } = useLoanMeta()
  const { data, isFetching } = useQuery({
    queryKey: ['loans', 'member', memberId],
    queryFn: async () => (await api.get<Paginated<LoanRow>>('/loans', { params: { member_id: memberId, per_page: 50 } })).data,
    enabled: !!memberId,
  })
  if (!memberId) return <Empty description={tx('সদস্য নন')} />
  return (
    <Table<LoanRow>
      rowKey="id"
      size="small"
      loading={isFetching}
      dataSource={data?.data}
      pagination={false}
      scroll={{ x: 700 }}
      locale={{ emptyText: tx('কোনো ঋণ নেই') }}
      columns={[
        { title: tx('ঋণ নং'), dataIndex: 'loan_no', render: (v, r) => <Link to={`/loans/${r.id}`}>{digits(v)}</Link> },
        { title: tx('আবেদনের তারিখ'), dataIndex: 'applied_on', render: fmtDate },
        { title: tx('বিতরণ'), dataIndex: 'disbursed_on', render: fmtDate },
        { title: tx('পরিমাণ'), dataIndex: 'amount', align: 'right', render: money },
        { title: tx('কিস্তি'), dataIndex: 'installments', render: (v) => digits(v) },
        { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag color={LOAN_STATUS_COLOR[s]}>{meta?.statuses[s] ?? s}</Tag> },
      ]}
    />
  )
}

type ReceiptRow = { id: number; receipt_no: string; date: string; method: string; amount: string; status: string; is_legacy: boolean; legacy_no: string | null }

export function PaymentsTab({ farmerId }: { farmerId: number }) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useQuery({
    queryKey: ['receipts', 'farmer', farmerId, page],
    queryFn: async () => (await api.get<Paginated<ReceiptRow>>('/receipts', { params: { farmer_id: farmerId, page, per_page: 10 } })).data,
    placeholderData: keepPreviousData,
  })
  return (
    <Table<ReceiptRow>
      rowKey="id"
      size="small"
      loading={isFetching}
      dataSource={data?.data}
      scroll={{ x: 600 }}
      locale={{ emptyText: tx('কোনো রশিদ নেই') }}
      pagination={{ current: page, pageSize: 10, total: data?.total, onChange: setPage, showSizeChanger: false }}
      columns={[
        { title: tx('রশিদ নং'), dataIndex: 'receipt_no', render: (v, r) => <Link to={`/payments/receipts/${r.id}`}>{digits(v)}</Link> },
        { title: tx('পুরনো রশিদ নং'), dataIndex: 'legacy_no', render: (v) => (v ? digits(v) : '') },
        { title: tx('তারিখ'), dataIndex: 'date', render: fmtDate },
        { title: tx('মাধ্যম'), dataIndex: 'method', render: (v) => METHOD_LABEL[v] ?? v },
        { title: tx('টাকা'), dataIndex: 'amount', align: 'right', render: money },
        { title: tx('অবস্থা'), dataIndex: 'status', render: (s) => <Tag color={RECEIPT_STATUS_COLOR[s]}>{RECEIPT_STATUS_LABEL[s] ?? s}</Tag> },
      ]}
    />
  )
}
