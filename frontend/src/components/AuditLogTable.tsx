import { useState } from 'react'
import { Descriptions, Drawer, Table, Tag } from 'antd'
import type { Paginated } from '../lib/api'
import { ACTION_LABELS, digits, fmtDateTime } from '../lib/format'
import type { AuditLog } from '../lib/types'
import { t as tx } from '../lib/i18n'

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Old vs new, with changed rows highlighted. */
function DiffTable({ log }: { log: AuditLog }) {
  const keys = Array.from(new Set([...Object.keys(log.old_values ?? {}), ...Object.keys(log.new_values ?? {})]))
  if (!keys.length) return <p>{tx('পরিবর্তনের বিস্তারিত নেই।')}</p>

  const rows = keys.map((k) => ({ key: k, old: log.old_values?.[k], new: log.new_values?.[k] }))
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="key"
      dataSource={rows}
      scroll={{ x: 500 }}
      columns={[
        { title: tx('ফিল্ড'), dataIndex: 'key', width: 160 },
        { title: tx('আগের মান'), dataIndex: 'old', render: (v, r) => <span className={show(r.old) !== show(r.new) && log.old_values ? 'diff-old' : ''}>{show(v)}</span> },
        { title: tx('নতুন মান'), dataIndex: 'new', render: (v, r) => <span className={show(r.old) !== show(r.new) ? 'diff-new' : ''}>{show(v)}</span> },
      ]}
    />
  )
}

export default function AuditLogTable({
  data,
  loading,
  page,
  onPage,
  hideUser,
  modules,
}: {
  data?: Paginated<AuditLog>
  loading: boolean
  page: number
  onPage: (page: number, perPage: number) => void
  hideUser?: boolean
  modules?: Record<string, string>
}) {
  const [open, setOpen] = useState<AuditLog | null>(null)

  return (
    <>
      <Table<AuditLog>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.data}
        scroll={{ x: 800 }}
        onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: 'pointer' } })}
        pagination={{
          current: page,
          pageSize: data?.per_page,
          total: data?.total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (t) => tx('মোট {{p0}}টি', { p0: digits(t) }),
          onChange: onPage,
        }}
        columns={[
          { title: tx('সময়'), dataIndex: 'created_at', render: fmtDateTime, width: 170 },
          ...(hideUser ? [] : [{ title: tx('ইউজার'), render: (_: unknown, r: AuditLog) => r.user?.name_bn ?? tx('সিস্টেম') }]),
          { title: tx('মডিউল'), dataIndex: 'module', render: (m: string) => modules?.[m] ?? m },
          { title: tx('কাজ'), dataIndex: 'action', render: (a: string) => <Tag>{ACTION_LABELS[a] ?? a}</Tag> },
          { title: tx('রেকর্ড'), render: (_, r) => (r.auditable_type ? `${r.auditable_type} #${digits(r.auditable_id)}` : '—') },
          { title: tx('বিবরণ'), dataIndex: 'description', ellipsis: true },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={tx('অডিট বিস্তারিত')} size={640}>
        {open && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label={tx('সময়')}>{fmtDateTime(open.created_at)}</Descriptions.Item>
              <Descriptions.Item label={tx('ইউজার')}>{open.user?.name_bn ?? tx('সিস্টেম')}</Descriptions.Item>
              <Descriptions.Item label={tx('মডিউল')}>{modules?.[open.module] ?? open.module}</Descriptions.Item>
              <Descriptions.Item label={tx('কাজ')}>{ACTION_LABELS[open.action] ?? open.action}</Descriptions.Item>
              <Descriptions.Item label={tx('রেকর্ড')}>{open.auditable_type ? `${open.auditable_type} #${open.auditable_id}` : '—'}</Descriptions.Item>
              {open.description && <Descriptions.Item label={tx('বিবরণ')}>{open.description}</Descriptions.Item>}
              <Descriptions.Item label="IP">{open.ip_address ?? '—'}</Descriptions.Item>
            </Descriptions>
            <DiffTable log={open} />
          </>
        )}
      </Drawer>
    </>
  )
}
