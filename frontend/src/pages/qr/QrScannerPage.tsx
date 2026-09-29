import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Result, Select, Tag } from 'antd'
import { CameraOutlined, EditOutlined, HistoryOutlined, QrcodeOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons'
import jsQR from 'jsqr'
import PageFrame from '../../components/PageFrame'
import { api, errorMessage, type Paginated } from '../../lib/api'
import { digits, fmtDateTime } from '../../lib/format'
import { parseQr } from '../../lib/phase8'
import { t as tx } from '../../lib/i18n'
import '../lands/land-list.css'
import '../irrigation/invoices.css'
import '../irrigation/invoice-detail.css'
import '../savings/savings.css'
import '../loans/loans.css'
import './qr.css'

export type QrResolved = { type: string; id: number; label: string | null; path: string; allowed: boolean }
type Recent = { id: number; entity_type: string; code: string; label: string | null; found: boolean; created_at: string }

const TYPE_OPTIONS = [
  { value: 'farmer', label: tx('কৃষক (কৃষক আইডি)') },
  { value: 'member', label: tx('সদস্য (সদস্য নং)') },
  { value: 'land', label: tx('জমি (জমি আইডি)') },
  { value: 'asset', label: tx('সম্পদ (সম্পদ কোড)') },
  { value: 'receipt', label: tx('রশিদ (যাচাই কোড)') },
  { value: 'combined', label: tx('সমন্বিত রশিদ (যাচাই কোড)') },
]

/** Logs the scan server-side and opens the matching screen. */
export async function resolveQr(type: string, code: string, source: 'camera' | 'manual' | 'link') {
  return (await api.post<QrResolved>('/qr/resolve', { type, code, source })).data
}

/** Read a QR code with the camera (or type the code) and jump to the farmer, member, land, asset or receipt it names. */
export default function QrScannerPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [denied, setDenied] = useState<QrResolved | null>(null)
  const [form] = Form.useForm()

  const recent = useQuery({
    queryKey: ['qr-history', 'recent'],
    queryFn: async () => (await api.get<Paginated<Recent> & { types: Record<string, string> }>('/qr/history', { params: { per_page: 6 } })).data,
  })

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }, [])
  useEffect(() => stop, [stop])

  const open = useCallback(
    async (type: string, code: string, source: 'camera' | 'manual') => {
      busyRef.current = true
      setDenied(null)
      try {
        const r = await resolveQr(type, code, source)
        queryClient.invalidateQueries({ queryKey: ['qr-history'] })
        if (!r.allowed) {
          setDenied(r)
          return
        }
        stop()
        navigate(r.path)
      } catch (e) {
        message.error(errorMessage(e))
      } finally {
        // give the user a moment before the same code is read again
        setTimeout(() => (busyRef.current = false), 1500)
      }
    },
    [message, navigate, stop, queryClient],
  )

  const start = async () => {
    setCamError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(tx('এই ব্রাউজারে ক্যামেরা ব্যবহার করা যাচ্ছে না (HTTPS দরকার)। নিচে কোড লিখে খুঁজুন।'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setScanning(true)
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      const tick = () => {
        if (!streamRef.current) return
        const canvas = canvasRef.current!
        if (video.readyState === video.HAVE_ENOUGH_DATA && !busyRef.current) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (hit?.data) {
            const p = parseQr(hit.data)
            void open(p?.type ?? 'unknown', p?.code ?? hit.data.slice(0, 100), 'camera')
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } catch {
      stop()
      setCamError(tx('ক্যামেরা চালু করা যায়নি — অনুমতি দিন বা নিচে কোড লিখে খুঁজুন।'))
    }
  }

  const manual = async () => {
    const v = await form.validateFields()
    const p = parseQr(v.code)
    await open(p?.type ?? v.type, p?.code ?? v.code, 'manual')
  }

  return (
    <PageFrame
      crumbs={[{ label: tx('নগদ ও পেমেন্ট'), to: '/payments/receipts' }, { label: tx('QR স্ক্যানার') }]}
      title={tx('QR স্ক্যানার')}
      actions={
        <Button icon={<HistoryOutlined />} className="fm-history-btn" onClick={() => navigate('/qr/history')}>
          {tx('স্ক্যানের ইতিহাস')}
        </Button>
      }
    >
      <div className="ln-form-grid">
        <section className="id-box">
          <header>
            <CameraOutlined />
            <h3>{tx('ক্যামেরা দিয়ে স্ক্যান')}</h3>
          </header>
          <div className="qr-body">
            <div className="qr-view" style={{ display: scanning ? 'block' : 'none' }}>
              <video ref={videoRef} muted playsInline />
              <div className="qr-aim" />
            </div>
            {!scanning && (
              <div className="qr-idle">
                <QrcodeOutlined />
                <p>{tx('ক্যামেরা চালু করে QR কোডটি ফ্রেমের মাঝে ধরুন — মিলে গেলে সংশ্লিষ্ট পাতা নিজে থেকে খুলবে।')}</p>
              </div>
            )}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {camError && <Alert type="warning" showIcon title={camError} />}
            {scanning ? (
              <Button block icon={<StopOutlined />} onClick={stop}>
                {tx('ক্যামেরা বন্ধ')}
              </Button>
            ) : (
              <Button type="primary" block icon={<CameraOutlined />} onClick={start}>
                {tx('ক্যামেরা চালু করুন')}
              </Button>
            )}
          </div>
        </section>

        <div className="ln-side">
          <section className="id-box">
            <header>
              <EditOutlined />
              <h3>{tx('কোড লিখে খুঁজুন')}</h3>
            </header>
            <div className="qr-body">
              <Form form={form} layout="vertical" className="iv-form" initialValues={{ type: 'farmer' }} onFinish={manual}>
                <Form.Item name="type" label={tx('কিসের কোড')}>
                  <Select options={TYPE_OPTIONS} />
                </Form.Item>
                <Form.Item name="code" label={tx('কোড')} rules={[{ required: true, message: tx('কোড লিখুন') }]} extra={tx('QR-এর লিংকও পেস্ট করা যাবে।')}>
                  <Input autoFocus maxLength={300} prefix={<QrcodeOutlined />} placeholder={tx('যেমন: F-000123')} />
                </Form.Item>
                <Button type="primary" block htmlType="submit" icon={<SearchOutlined />}>
                  {tx('খুঁজুন')}
                </Button>
              </Form>
              {denied && <Result status="403" title={denied.label} subTitle={tx('পাওয়া গেছে, কিন্তু এই তথ্য দেখার অনুমতি আপনার নেই।')} />}
            </div>
          </section>

          <section className="id-box">
            <header>
              <HistoryOutlined />
              <h3>{tx('সাম্প্রতিক স্ক্যান')}</h3>
            </header>
            <ul className="qr-recent">
              {(recent.data?.data ?? []).map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>{r.label || digits(r.code)}</strong>
                    <small>
                      {recent.data?.types[r.entity_type] ?? r.entity_type} · {fmtDateTime(r.created_at)}
                    </small>
                  </span>
                  {r.found ? <Tag className="fl-tag fl-tag-green">{tx('পাওয়া গেছে')}</Tag> : <Tag className="fl-tag fl-tag-red">{tx('পাওয়া যায়নি')}</Tag>}
                </li>
              ))}
              {recent.data && recent.data.data.length === 0 && <li className="qr-none">{tx('এখনো কোনো স্ক্যান নেই')}</li>}
            </ul>
            {!!recent.data?.data.length && (
              <div className="qr-more">
                <Link to="/qr/history">{tx('সব স্ক্যান দেখুন')}</Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </PageFrame>
  )
}
