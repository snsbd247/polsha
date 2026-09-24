import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, Descriptions, Result, Spin, Typography } from 'antd'
import { api } from '../lib/api'
import { money } from '../lib/accounting'
import { digits, fmtDate } from '../lib/format'
import { RECEIPT_STATUS_LABEL } from '../lib/irrigation'
import { logoUrl, usePublicSettings } from '../lib/settings'
import { nameOf, t as tx } from '../lib/i18n'
import LanguageToggle from '../components/LanguageToggle'

type Verified = {
  receipt_no: string
  date: string
  payer_name: string
  amount: number
  status: string
  status_label: string
  parts?: { module: string; label: string; amount: number }[]
}

/** Public page behind the QR code on a printed receipt (irrigation or combined) — no login needed. */
export default function VerifyReceiptPage() {
  const { kind = 'receipt', token } = useParams()
  const { data: settings } = usePublicSettings()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['verify-receipt', kind, token],
    queryFn: async () => (await api.get<Verified>(kind === 'combined' ? `/public/combined-receipts/${token}` : `/public/receipts/${token}`)).data,
    retry: false,
  })

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <LanguageToggle />
        </div>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          {settings?.logo && <img src={logoUrl()} alt="" style={{ height: 56, marginBottom: 8 }} />}
          <Typography.Title level={4} style={{ margin: 0 }}>
            {nameOf({ name_bn: settings?.society_name_bn, name_en: settings?.society_name_en }) || tx('সমবায় ERP')}
          </Typography.Title>
          <Typography.Text type="secondary">{kind === 'combined' ? tx('সমন্বিত রশিদ যাচাই') : tx('রশিদ যাচাই')}</Typography.Text>
        </div>
        {isLoading ? (
          <Spin style={{ display: 'block' }} />
        ) : isError || !data ? (
          <Result status="error" title={tx('রশিদ পাওয়া যায়নি')} subTitle={tx('এই QR কোডের কোনো রশিদ আমাদের রেকর্ডে নেই। রশিদটি জাল হতে পারে।')} />
        ) : (
          <>
            <Result
              status={data.status === 'active' ? 'success' : data.status === 'cancelled' ? 'error' : 'warning'}
              title={data.status === 'active' ? tx('রশিদটি বৈধ') : data.status === 'cancelled' ? tx('রশিদটি বাতিল করা হয়েছে') : tx('রশিদটি বাতিলের প্রক্রিয়াধীন')}
              style={{ padding: '8px 0 16px' }}
            />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={tx('রশিদ নং')}>{digits(data.receipt_no)}</Descriptions.Item>
              <Descriptions.Item label={tx('তারিখ')}>{fmtDate(data.date)}</Descriptions.Item>
              <Descriptions.Item label={tx('প্রদানকারী')}>{data.payer_name}</Descriptions.Item>
              {data.parts?.map((p) => (
                <Descriptions.Item key={p.module} label={p.label}>
                  ৳{money(p.amount)}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label={tx('টাকা')}>৳{money(data.amount)}</Descriptions.Item>
              <Descriptions.Item label={tx('অবস্থা')}>{RECEIPT_STATUS_LABEL[data.status] ?? data.status_label}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Card>
    </div>
  )
}
