import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, DatePicker, Dropdown, Empty, Form, Input, Select, Space, Table, Typography } from 'antd'
import { DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '../lib/api'
import { digits, fmtDateTime } from '../lib/format'
import { nameOf, t as tx } from '../lib/i18n'
import { usePublicSettings } from '../lib/settings'
import { cellText, exportCsv, exportXlsx, printReport, summaryText, type ReportColumn, type ReportResult, type ReportRow } from '../lib/reports'

type Params = Record<string, string | number | undefined>

const num = (c: ReportColumn) => c.type === 'money' || c.type === 'number' || c.type === 'decimal'

/** One report from the backend registry: its filters, table, totals and summary, with print (PDF) / Excel / CSV. */
export default function ReportView({ reportKey, initial, onData }: { reportKey: string; initial?: Params; onData?: (r: ReportResult) => void }) {
  const { data: settings } = usePublicSettings()
  const [params, setParams] = useState<Params>(initial ?? {})
  const [form] = Form.useForm()
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['report', reportKey, params],
    queryFn: async () => (await api.get<ReportResult>(`/reports/${reportKey}`, { params })).data,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const society = nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en })
  // lets a surrounding page show this report's summary (e.g. as cards)
  useEffect(() => {
    if (data) onData?.(data)
  }, [data, onData])

  const apply = (v: Record<string, unknown>) => {
    const next: Params = {}
    for (const [k, val] of Object.entries(v)) {
      if (k === 'period' && Array.isArray(val) && val[0]) {
        next.from = (val[0] as Dayjs).format('YYYY-MM-DD')
        next.to = (val[1] as Dayjs).format('YYYY-MM-DD')
      } else if (dayjs.isDayjs(val)) next[k] = val.format('YYYY-MM-DD')
      else if (val !== undefined && val !== null && val !== '') next[k] = val as string | number
    }
    setParams(next)
  }

  const initialValues = (r: ReportResult) => {
    const v: Record<string, unknown> = {}
    for (const f of r.filters) {
      if (f.type === 'period') v.period = [dayjs(String(r.values.from)), dayjs(String(r.values.to))]
      else if (f.type === 'date') v[f.name] = r.values[f.name] ? dayjs(String(r.values[f.name])) : undefined
      else v[f.name] = r.values[f.name] ?? undefined
    }
    return v
  }

  return (
    <>
      {data && data.filters.length > 0 && (
        <Form key={data.key} form={form} layout="inline" className="toolbar" initialValues={initialValues(data)} onFinish={apply} style={{ rowGap: 8, marginBottom: 12 }}>
          {data.filters.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label}>
              {f.type === 'period' ? (
                <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} />
              ) : f.type === 'date' ? (
                <DatePicker format="DD/MM/YYYY" allowClear={false} />
              ) : f.type === 'select' ? (
                <Select
                  allowClear={!f.required && !f.default}
                  showSearch={{ optionFilterProp: 'label' }}
                  placeholder={tx('সব')}
                  style={{ minWidth: 180 }}
                  options={(f.options ?? []).map((o) => ({ value: o.value, label: digits(o.label) }))}
                />
              ) : (
                <Input allowClear style={{ width: 180 }} />
              )}
            </Form.Item>
          ))}
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isFetching}>
              {tx('দেখুন')}
            </Button>
          </Form.Item>
        </Form>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <Typography.Text type="secondary">{data ? `${digits(data.subtitle)} · ${tx('মোট সারি: {{n}}', { n: digits(data.rows.length) })}` : ''}</Typography.Text>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
          <Button icon={<PrinterOutlined />} disabled={!data || !!data.notice} onClick={() => data && printReport(data, society)}>
            {tx('প্রিন্ট / PDF')}
          </Button>
          <Dropdown
            disabled={!data || !!data.notice}
            menu={{
              items: [
                { key: 'xlsx', label: 'Excel (.xlsx)', onClick: () => data && exportXlsx(data, society) },
                { key: 'csv', label: 'CSV', onClick: () => data && exportCsv(data) },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />}>{tx('ডাউনলোড')}</Button>
          </Dropdown>
        </Space>
      </div>

      {error && <Alert type="error" showIcon title={errorMessage(error)} style={{ marginBottom: 12 }} />}
      {data?.notice && <Alert type="info" showIcon title={data.notice} style={{ marginBottom: 12 }} />}
      {data?.truncated && <Alert type="warning" showIcon title={tx('প্রথম ৫০০০ সারি দেখানো হচ্ছে; ছোট সময়কাল বা ফিল্টার দিন।')} style={{ marginBottom: 12 }} />}

      <Table<ReportRow & { __i: number }>
        rowKey="__i"
        size="small"
        loading={isFetching}
        dataSource={data?.rows.map((r, i) => ({ ...r, __i: i }))}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty description={tx('কোনো তথ্য নেই')} /> }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 500], hideOnSinglePage: true }}
        columns={(data?.columns ?? []).map((c) => ({
          key: c.key,
          title: c.label,
          dataIndex: c.key,
          align: num(c) ? ('right' as const) : undefined,
          render: (v: unknown) => cellText(c, v),
        }))}
        summary={() =>
          data && data.columns.some((c) => c.sum) && data.rows.length > 0 ? (
            <Table.Summary fixed>
              <Table.Summary.Row>
                {data.columns.map((c, i) => (
                  <Table.Summary.Cell key={c.key} index={i} align={num(c) ? 'right' : undefined}>
                    <b>{c.sum ? cellText(c, data.totals[c.key]) : i === 0 ? tx('মোট') : ''}</b>
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            </Table.Summary>
          ) : null
        }
      />

      {data && data.summary.length > 0 && (
        <table className="report-summary" style={{ marginTop: 16, borderCollapse: 'collapse' }}>
          <tbody>
            {data.summary.map((s) => (
              <tr key={s.label}>
                <td style={{ padding: '4px 16px 4px 0' }}>{s.label}</td>
                <td style={{ padding: 4, textAlign: 'right', fontWeight: 600 }}>{summaryText(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
          {tx('প্রস্তুত: {{d}}', { d: fmtDateTime(data.generated_at) })}
        </Typography.Paragraph>
      )}
    </>
  )
}
