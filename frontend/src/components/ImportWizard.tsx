import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Descriptions, Popconfirm, Select, Space, Steps, Table, Tag, Typography, Upload } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { api, errorMessage } from '../lib/api'
import { money } from '../lib/accounting'
import { digits, fmtDate } from '../lib/format'
import { buildXlsx, download, type Cell } from '../lib/reports'
import { t as tx } from '../lib/i18n'

export type ImportTypeKey = 'farmers' | 'lands' | 'savings_opening' | 'share_opening' | 'loan_opening' | 'legacy_irrigation' | 'payments'
type Column = { key: string; label: string; required: boolean }
export type ImportTypeInfo = { key: ImportTypeKey; label: string; money: boolean; allowed: boolean; columns: Column[]; template: [string[], string[]] }
type Issue = { line: number; messages: string[] }
type Upload = { upload_token: string; filename: string; total: number; headers: { index: number; label: string }[]; sample: string[][]; columns: Column[]; mapping: Record<string, number> }
type Preview = { token: string; total: number; valid: number; amount: number; errors: Issue[]; warnings: Issue[] }
type Batch = { id: number; imported_rows: number; skipped_rows: number; total_amount: string | null }

export function useImportTypes() {
  return useQuery({
    queryKey: ['import-types'],
    queryFn: async () => (await api.get<{ opening_date: string; types: ImportTypeInfo[] }>('/imports/types')).data,
    staleTime: 5 * 60_000,
  })
}

/** Excel template: Bangla header row + one example row, text cells so codes keep their leading zeros. */
export function downloadTemplate(info: ImportTypeInfo) {
  const [header, sample] = info.template
  const rows: Cell[][] = [header.map((h) => ({ v: h, kind: 'text', style: 1 })), sample.map((v) => ({ v, kind: 'text' }))]
  download(buildXlsx(info.label, rows, header.map((h) => Math.max(12, h.length + 4))), `${info.key}-template.xlsx`)
}

const issueColumns = [
  { title: tx('সারি'), dataIndex: 'line', width: 70, render: digits },
  { title: tx('বিবরণ'), dataIndex: 'messages', render: (m: string[]) => m.map((x, i) => <div key={i}>{x}</div>) },
]

/**
 * upload (CSV/.xlsx) → match columns → check every row → import.
 * Money imports never pass a row with a warning; they post to the ledger against Opening Balance Equity.
 */
export default function ImportWizard({ type, help }: { type: ImportTypeKey; help: string[] }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { data: meta } = useImportTypes()
  const info = meta?.types.find((t) => t.key === type)
  const [up, setUp] = useState<Upload | null>(null)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<Batch | null>(null)
  const [busy, setBusy] = useState(false)
  const [allowSimilar, setAllowSimilar] = useState(false)

  const reset = () => {
    setUp(null)
    setPreview(null)
    setMapping({})
    setAllowSimilar(false)
  }

  const upload = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    setBusy(true)
    setResult(null)
    setPreview(null)
    try {
      const r = (await api.post<Upload>(`/imports/${type}/upload`, fd)).data
      setUp(r)
      setMapping(r.mapping)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
    return false
  }

  const check = async () => {
    setBusy(true)
    try {
      setPreview((await api.post<Preview>('/imports/validate', { upload_token: up!.upload_token, mapping })).data)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    try {
      const r = (await api.post<Batch>('/imports/commit', { token: preview!.token, allow_similar: allowSimilar })).data
      setResult(r)
      reset()
      message.success(tx('{{p0}}টি সারি Import হয়েছে।', { p0: digits(r.imported_rows) }))
      queryClient.invalidateQueries()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const headerOptions = useMemo(() => (up?.headers ?? []).map((h) => ({ value: h.index, label: h.label })), [up])
  const missing = (up?.columns ?? []).filter((c) => c.required && (mapping[c.key] === undefined || mapping[c.key] === null))
  const step = result ? 3 : preview ? 2 : up ? 1 : 0

  if (info && !info.allowed) return <Alert type="warning" showIcon title={tx('এই ধরনের ইমপোর্টের অনুমতি আপনার নেই।')} />

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Steps current={step} size="small" items={[{ title: tx('ফাইল আপলোড') }, { title: tx('কলাম মেলানো') }, { title: tx('যাচাই ও প্রিভিউ') }, { title: 'Import' }]} />
      <Alert
        type="info"
        showIcon
        title={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {help.map((h) => (
              <li key={h}>{h}</li>
            ))}
            {info?.money && meta && (
              <li>
                <strong>{tx('প্রারম্ভিক তারিখ: {{p0}}', { p0: fmtDate(meta.opening_date) })}</strong> —{' '}
                {tx('হিসাবে "Opening Balance Equity"-র বিপরীতে পোস্ট হবে। Go-live তারিখ "সিস্টেম পছন্দসমূহ" পাতায় ঠিক করুন।')}
              </li>
            )}
            <li>{tx('Excel (.xlsx) বা CSV ফাইল দিন; প্রথম সারিতে কলামের নাম। একবারে সর্বোচ্চ ৫০০০ সারি।')}</li>
            <li>{tx('হাতে লেখা খাতা থেকে: Template ডাউনলোড করে খাতা দেখে পূরণ করুন, তারপর আপলোড দিন।')}</li>
          </ul>
        }
      />
      <Space wrap>
        <Button icon={<DownloadOutlined />} disabled={!info} onClick={() => info && downloadTemplate(info)}>
          {tx('Excel Template ডাউনলোড')}
        </Button>
        <Link to={`/imports/audit?type=${type}`}>{tx('আগের ইমপোর্ট ও রোলব্যাক')}</Link>
      </Space>

      {!up && !preview && (
        <Upload.Dragger accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" showUploadList={false} beforeUpload={upload} disabled={busy}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>{busy ? tx('ফাইল পড়া হচ্ছে…') : tx('{{p0}}-এর Excel/CSV ফাইল এখানে টেনে আনুন বা ক্লিক করুন', { p0: info?.label ?? '' })}</p>
        </Upload.Dragger>
      )}

      {up && !preview && (
        <Card title={tx('কলাম মেলান — {{p0}} ({{p1}}টি সারি)', { p0: up.filename, p1: digits(up.total) })}>
          <Typography.Paragraph type="secondary">{tx('ফাইলের কোন কলামে কোন তথ্য আছে তা মিলিয়ে দিন। নাম মিললে সিস্টেম নিজেই মিলিয়ে রেখেছে।')}</Typography.Paragraph>
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={up.columns}
            columns={[
              { title: tx('সিস্টেমের ঘর'), dataIndex: 'label', render: (l, c) => (c.required ? <strong>{l} *</strong> : l) },
              {
                title: tx('ফাইলের কলাম'),
                render: (_, c) => (
                  <Select
                    allowClear
                    style={{ width: '100%', minWidth: 200 }}
                    placeholder={tx('— নেই —')}
                    value={mapping[c.key] ?? undefined}
                    options={headerOptions}
                    status={c.required && (mapping[c.key] === undefined || mapping[c.key] === null) ? 'error' : undefined}
                    onChange={(v) => setMapping((m) => ({ ...m, [c.key]: v ?? null }))}
                  />
                ),
              },
              {
                title: tx('নমুনা'),
                render: (_, c) => {
                  const i = mapping[c.key]
                  return i === undefined || i === null ? '' : <Typography.Text type="secondary">{up.sample.slice(0, 3).map((row) => row[i] ?? '').filter(Boolean).join(' · ')}</Typography.Text>
                },
              },
            ]}
          />
          {missing.length > 0 && <Alert style={{ marginTop: 12 }} type="warning" showIcon title={tx('প্রয়োজনীয় ঘর মেলানো বাকি: {{p0}}', { p0: missing.map((c) => c.label).join(', ') })} />}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={missing.length > 0} loading={busy} onClick={check}>
              {tx('যাচাই করুন')}
            </Button>
            <Button onClick={reset}>{tx('বাতিল')}</Button>
          </Space>
        </Card>
      )}

      {preview && (
        <Card title={tx('যাচাইয়ের ফলাফল')}>
          <Descriptions size="small" column={{ xs: 1, md: info?.money ? 5 : 4 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label={tx('মোট সারি')}>{digits(preview.total)}</Descriptions.Item>
            <Descriptions.Item label={tx('ঠিক আছে')}>
              <Tag color="green">{digits(preview.valid)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={tx('ভুল')}>
              <Tag color={preview.errors.length ? 'red' : 'default'}>{digits(preview.errors.length)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={tx('সতর্কতা')}>
              <Tag color={preview.warnings.length ? 'orange' : 'default'}>{digits(preview.warnings.length)}</Tag>
            </Descriptions.Item>
            {info?.money && <Descriptions.Item label={tx('মোট টাকা')}>৳{money(preview.amount)}</Descriptions.Item>}
          </Descriptions>
          {preview.errors.length > 0 && (
            <>
              <Typography.Title level={5}>{tx('ভুল — এই সারিগুলো Import হবে না')}</Typography.Title>
              <Table rowKey="line" size="small" pagination={{ pageSize: 10 }} dataSource={preview.errors} columns={issueColumns} />
            </>
          )}
          {preview.warnings.length > 0 && (
            <>
              <Typography.Title level={5}>{tx('সতর্কতা')}</Typography.Title>
              <Table rowKey="line" size="small" pagination={{ pageSize: 10 }} dataSource={preview.warnings} columns={issueColumns} />
              {!info?.money && (
                <Checkbox checked={allowSimilar} onChange={(e) => setAllowSimilar(e.target.checked)} style={{ marginTop: 8 }}>
                  {tx('সম্ভাব্য ডুপ্লিকেট সারিগুলোও Import করুন (না দিলে এগুলো বাদ যাবে)')}
                </Checkbox>
              )}
            </>
          )}
          <Space style={{ marginTop: 16 }} wrap>
            <Popconfirm
              title={tx('{{p0}}টি সারি Import করবেন?', { p0: digits(preview.valid) })}
              description={info?.money ? tx('মোট ৳{{p0}} হিসাবে পোস্ট হবে। ভুল হলে পরে লেনদেন না হওয়া পর্যন্ত অনুমোদন নিয়ে রোলব্যাক করা যাবে।', { p0: money(preview.amount) }) : undefined}
              onConfirm={commit}
            >
              <Button type="primary" disabled={!preview.valid} loading={busy}>
                {digits(preview.valid)}
                {tx('টি সারি Import করুন')}
              </Button>
            </Popconfirm>
            <Button onClick={() => setPreview(null)}>{tx('কলাম আবার মেলান')}</Button>
            <Button onClick={reset}>{tx('বাতিল')}</Button>
          </Space>
        </Card>
      )}

      {result && (
        <Alert
          type={result.skipped_rows ? 'warning' : 'success'}
          showIcon
          title={
            <>
              {tx('ব্যাচ #{{p0}}: {{p1}}টি Import হয়েছে, {{p2}}টি বাদ।', { p0: digits(result.id), p1: digits(result.imported_rows), p2: digits(result.skipped_rows) })}
              {info?.money && result.total_amount && ` ${tx('মোট')} ৳${money(result.total_amount)}।`}{' '}
              <Link to={`/imports/audit?batch=${result.id}`}>{tx('বিস্তারিত')}</Link>
            </>
          }
        />
      )}
    </Space>
  )
}
