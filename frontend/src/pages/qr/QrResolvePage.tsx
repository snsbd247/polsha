import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Result, Spin } from 'antd'
import { errorMessage } from '../../lib/api'
import { t as tx } from '../../lib/i18n'
import { resolveQr, type QrResolved } from './QrScannerPage'

/** Target of a printed QR label ("/q/{type}/{code}") — needs login; the scan is logged. */
export default function QrResolvePage() {
  const { type = '', code = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState<QrResolved | null>(null)

  useEffect(() => {
    let live = true
    resolveQr(type, code, 'link')
      .then((r) => {
        if (!live) return
        if (r.allowed) navigate(r.path, { replace: true })
        else setDenied(r)
      })
      .catch((e) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [type, code, navigate])

  const back = (
    <Link to="/qr/scan">
      <Button>{tx('QR স্ক্যানার')}</Button>
    </Link>
  )
  if (denied) return <Result status="403" title={denied.label} subTitle={tx('পাওয়া গেছে, কিন্তু এই তথ্য দেখার অনুমতি আপনার নেই।')} extra={back} />
  if (error) return <Result status="404" title={tx('কোড পাওয়া যায়নি')} subTitle={error} extra={back} />
  return <Spin style={{ display: 'block', marginTop: 64 }} />
}
