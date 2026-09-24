import { Table } from 'antd'
import { money } from '../../lib/accounting'
import { digits, fmtDate } from '../../lib/format'
import type { ScheduleRow } from '../../lib/loans'
import { t as tx } from '../../lib/i18n'

/** Planned instalments before disbursement: principal and interest apart. */
export default function SchedulePreview({ rows, loading }: { rows?: ScheduleRow[]; loading?: boolean }) {
  const sum = (k: 'principal' | 'interest') => (rows ?? []).reduce((s, r) => s + Number(r[k]), 0)
  return (
    <Table<ScheduleRow>
      rowKey="seq"
      size="small"
      loading={loading}
      dataSource={rows}
      pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: tx('কিস্তি'), dataIndex: 'seq', width: 70, render: (v: number) => digits(v) },
        { title: tx('তারিখ'), dataIndex: 'due_date', render: fmtDate },
        { title: tx('আসল'), dataIndex: 'principal', align: 'right', render: money },
        { title: tx('সুদ'), dataIndex: 'interest', align: 'right', render: money },
        { title: tx('মোট'), align: 'right', render: (_, r) => money(Number(r.principal) + Number(r.interest)) },
      ]}
      summary={() =>
        rows?.length ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}>
              <strong>{tx('মোট')}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <strong>{money(sum('principal'))}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <strong>{money(sum('interest'))}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong>{money(sum('principal') + sum('interest'))}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        ) : null
      }
    />
  )
}
