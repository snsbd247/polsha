import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Space, Steps, Table, Tabs, Tag, Typography, Upload } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { downloadExport } from '../../lib/phase2'
import { t as tx } from '../../lib/i18n'

type Issue = { line: number; messages: string[] }
type Preview = { token: string; total: number; valid: number; errors: Issue[]; warnings: Issue[]; sample: Record<string, unknown>[] }
type Batch = { id: number; type: string; filename: string; total_rows: number; imported_rows: number; skipped_rows: number; errors: Issue[] | null; created_at: string; creator: { name_bn: string } | null }

const TYPES = { farmers: tx('কৃষক'), lands: tx('জমি') } as const
type ImportType = keyof typeof TYPES

const HELP: Record<ImportType, string[]> = {
  farmers: [
    tx('উপজেলা, ইউনিয়ন, গ্রাম ও মৌজা (JL নম্বর) আগে "এলাকা" ও "মৌজা" পাতায় থাকতে হবে।'),
    tx('লিঙ্গ: পুরুষ / মহিলা / অন্যান্য। বাংলা অঙ্ক চলবে; মোবাইলের শুরুর ০ বাদ পড়লে সিস্টেম নিজে যোগ করবে।'),
    tx('"সদস্য নং" দিলে পুরোনো খাতার সদস্য হিসেবে সেই নম্বরেই যুক্ত হবে (সাথে "ভর্তির তারিখ" দিন/মাস/বছর)।'),
  ],
  lands: [
    tx('মালিক/চাষি: Farmer ID (F-000001), NID বা সদস্য নং দিয়ে চেনানো যাবে। একাধিক মালিক: "F-000001:50; F-000002:50"। অংশ না দিলে সমান ভাগ।'),
    tx('পরিমাণে একক লেখা যাবে: "৩৩", "১.৫ একর", "২ বিঘা"। একক না দিলে "একক" কলাম, তা-ও না থাকলে শতক।'),
    tx('চাষের ধরন: নিজ / বর্গা / লিজ। না দিলে চাষি মালিক হলে "নিজ", নইলে "বর্গা"।'),
  ],
}

function ImportTab({ type }: { type: ImportType }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [uploading, setUploading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [allowSimilar, setAllowSimilar] = useState(false)
  const [result, setResult] = useState<Batch | null>(null)

  const upload = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    setUploading(true)
    setResult(null)
    try {
      setPreview((await api.post<Preview>(`/imports/${type}/preview`, fd)).data)
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
    return false
  }

  const commit = async () => {
    setCommitting(true)
    try {
      const r = await api.post<Batch>('/imports/commit', { token: preview!.token, allow_similar: allowSimilar })
      setResult(r.data)
      setPreview(null)
      message.success(tx('{{p0}}টি সারি Import হয়েছে।', { p0: digits(r.data.imported_rows) }))
      queryClient.invalidateQueries()
    } catch (e) {
      message.error(errorMessage(e))
    } finally {
      setCommitting(false)
    }
  }

  const step = result ? 2 : preview ? 1 : 0
  const issueColumns = [
    { title: tx('সারি'), dataIndex: 'line', width: 70, render: digits },
    { title: tx('বিবরণ'), dataIndex: 'messages', render: (m: string[]) => m.map((x, i) => <div key={i}>{x}</div>) },
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Steps current={step} size="small" items={[{ title: tx('ফাইল আপলোড') }, { title: tx('যাচাই ও প্রিভিউ') }, { title: 'Import' }]} />
      <Alert
        type="info"
        showIcon
        title={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {HELP[type].map((h) => (
              <li key={h}>{h}</li>
            ))}
            <li>{tx('Excel থেকে "CSV UTF-8 (Comma delimited)" হিসেবে সেভ করুন। একবারে সর্বোচ্চ ৫০০০ সারি।')}</li>
          </ul>
        }
      />
      <Space wrap>
        <Button icon={<DownloadOutlined />} onClick={() => downloadExport(`/imports/template/${type}`, {}, `${type}-template.csv`).catch((e) => message.error(errorMessage(e)))}>
          {tx('Template ডাউনলোড')}
        </Button>
      </Space>
      <Upload.Dragger accept=".csv,text/csv" showUploadList={false} beforeUpload={upload} disabled={uploading}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>{uploading ? tx('যাচাই হচ্ছে…') : tx('{{p0}}ের CSV ফাইল এখানে টেনে আনুন বা ক্লিক করুন', { p0: TYPES[type] })}</p>
      </Upload.Dragger>

      {preview && (
        <Card title={tx('যাচাইয়ের ফলাফল')}>
          <Descriptions size="small" column={{ xs: 1, md: 4 }} bordered style={{ marginBottom: 16 }}>
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
              <Checkbox checked={allowSimilar} onChange={(e) => setAllowSimilar(e.target.checked)} style={{ marginTop: 8 }}>
                {tx('সম্ভাব্য ডুপ্লিকেট সারিগুলোও Import করুন (না দিলে এগুলো বাদ যাবে)')}
              </Checkbox>
            </>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={!preview.valid} loading={committing} onClick={commit}>
              {digits(preview.valid)}{tx('টি সারি Import করুন')}
            </Button>
            <Button onClick={() => setPreview(null)}>{tx('বাতিল')}</Button>
          </Space>
        </Card>
      )}

      {result && (
        <Alert
          type={result.skipped_rows ? 'warning' : 'success'}
          showIcon
          title={tx('ব্যাচ #{{p0}}: {{p1}}টি Import হয়েছে, {{p2}}টি বাদ।', { p0: digits(result.id), p1: digits(result.imported_rows), p2: digits(result.skipped_rows) })}
        />
      )}
    </Space>
  )
}

export default function ImportPage() {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Batch | null>(null)
  const { data, isFetching } = useQuery({
    queryKey: ['imports', page],
    queryFn: async () => (await api.get<Paginated<Batch>>('/imports', { params: { page } })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="page-header">
        <h2>Import (Excel/CSV)</h2>
      </div>
      <Card>
        <Tabs items={(Object.keys(TYPES) as ImportType[]).map((t) => ({ key: t, label: `${TYPES[t]} Import`, children: <ImportTab type={t} /> }))} />
      </Card>
      <Card title={tx('Import-এর ইতিহাস')} style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        <Table<Batch>
          rowKey="id"
          size="small"
          loading={isFetching}
          dataSource={data?.data}
          scroll={{ x: 700 }}
          onRow={(b) => ({ onClick: () => setOpen(b), style: { cursor: 'pointer' } })}
          pagination={{ current: page, pageSize: data?.per_page, total: data?.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          columns={[
            { title: tx('ব্যাচ'), dataIndex: 'id', render: (v) => `#${digits(v)}` },
            { title: tx('ধরন'), dataIndex: 'type', render: (t: ImportType) => TYPES[t] },
            { title: tx('ফাইল'), dataIndex: 'filename' },
            { title: 'Import', dataIndex: 'imported_rows', render: (v) => <Tag color="green">{digits(v)}</Tag> },
            { title: tx('বাদ'), dataIndex: 'skipped_rows', render: (v) => (v ? <Tag color="orange">{digits(v)}</Tag> : '—') },
            { title: tx('সময়'), render: (_, b) => `${b.creator?.name_bn ?? ''} · ${fmtDateTime(b.created_at)}` },
          ]}
        />
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} size={640} title={open ? tx('ব্যাচ #{{p0}} — বাদ পড়া সারি', { p0: digits(open.id) }) : ''}>
        <Table
          rowKey="line"
          size="small"
          dataSource={open?.errors ?? []}
          locale={{ emptyText: tx('কোনো সারি বাদ পড়েনি') }}
          columns={[
            { title: tx('সারি'), dataIndex: 'line', width: 70, render: digits },
            { title: tx('কারণ'), dataIndex: 'messages', render: (m: string[]) => m.map((x, i) => <div key={i}>{x}</div>) },
          ]}
        />
      </Drawer>
    </>
  )
}
