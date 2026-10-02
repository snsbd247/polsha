import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Modal } from 'antd'
import jsQR from 'jsqr'
import { parseQr } from '../lib/phase8'
import { t as tx } from '../lib/i18n'
import '../pages/field/field.css'

/** Reads a farmer card QR (or a member number QR) with the phone camera and hands back the code to search. */
export default function QrScanModal({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string, type: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return stop
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(tx('এই ব্রাউজারে ক্যামেরা ব্যবহার করা যাচ্ছে না (HTTPS দরকার)।'))
      return stop
    }
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const tick = () => {
          if (!streamRef.current) return
          const canvas = canvasRef.current!
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (hit?.data) {
              stop()
              const p = parseQr(hit.data)
              onCode(p?.code ?? hit.data.slice(0, 60), p?.type ?? null)
              return
            }
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      .catch(() => setError(tx('ক্যামেরা চালু করা যায়নি — অনুমতি দিন, অথবা নাম লিখে খুঁজুন।')))
    return () => {
      alive = false
      stop()
    }
  }, [open, stop, onCode])

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={tx('কার্ডের QR স্ক্যান করুন')} destroyOnHidden>
      {error ? <Alert type="warning" showIcon title={error} /> : <video ref={videoRef} className="fc-video" muted playsInline />}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </Modal>
  )
}
