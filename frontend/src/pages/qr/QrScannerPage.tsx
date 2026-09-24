import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, App, Button, Card, Col, Form, Input, Result, Row, Select, Space } from 'antd'
import { CameraOutlined, HistoryOutlined, StopOutlined } from '@ant-design/icons'
import jsQR from 'jsqr'
import { api, errorMessage } from '../../lib/api'
import { parseQr } from '../../lib/phase8'
import { t as tx } from '../../lib/i18n'

export type QrResolved = { type: string; id: number; label: string | null; path: string; allowed: boolean }

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

export default function QrScannerPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [denied, setDenied] = useState<QrResolved | null>(null)
  const [form] = Form.useForm()

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
    [message, navigate, stop],
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
    <>
      <div className="page-header">
        <h2>{tx('QR স্ক্যানার')}</h2>
        <Link to="/qr/history">
          <Button icon={<HistoryOutlined />}>{tx('স্ক্যানের ইতিহাস')}</Button>
        </Link>
      </div>
      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Card title={tx('ক্যামেরা দিয়ে স্ক্যান')} style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3', display: scanning ? 'block' : 'none' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: '15%', border: '3px solid rgba(82,196,26,.9)', borderRadius: 12 }} />
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {camError && <Alert type="warning" showIcon style={{ margin: '12px 0' }} title={camError} />}
            <Space style={{ marginTop: 12 }}>
              {scanning ? (
                <Button icon={<StopOutlined />} onClick={stop}>
                  {tx('ক্যামেরা বন্ধ')}
                </Button>
              ) : (
                <Button type="primary" icon={<CameraOutlined />} onClick={start}>
                  {tx('ক্যামেরা চালু করুন')}
                </Button>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title={tx('কোড লিখে খুঁজুন')} style={{ marginBottom: 16 }}>
            <Form form={form} layout="vertical" initialValues={{ type: 'farmer' }} onFinish={manual}>
              <Form.Item name="type" label={tx('কিসের কোড')}>
                <Select options={TYPE_OPTIONS} />
              </Form.Item>
              <Form.Item name="code" label={tx('কোড')} rules={[{ required: true, message: tx('কোড লিখুন') }]} extra={tx('QR-এর লিংকও পেস্ট করা যাবে।')}>
                <Input autoFocus maxLength={300} />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                {tx('খুঁজুন')}
              </Button>
            </Form>
          </Card>
          {denied && <Result status="403" title={denied.label} subTitle={tx('পাওয়া গেছে, কিন্তু এই তথ্য দেখার অনুমতি আপনার নেই।')} />}
        </Col>
      </Row>
    </>
  )
}
