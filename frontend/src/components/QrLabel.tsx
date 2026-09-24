import { Button, Card, Popover, QRCode } from 'antd'
import { PrinterOutlined, QrcodeOutlined } from '@ant-design/icons'
import { digits } from '../lib/format'
import { qrUrl } from '../lib/phase8'
import { t as tx } from '../lib/i18n'

/**
 * Printable QR sticker for a farmer / land / asset — opens the record after login.
 * With a heading (society name) and note it doubles as a member card.
 */
export default function QrLabel({ type, code, title, subtitle, heading, note }: { type: 'farmer' | 'member' | 'land' | 'asset'; code: string; title: string; subtitle?: string; heading?: string; note?: string }) {
  const id = `qr-label-${type}-${code}`
  const print = () => {
    const el = document.getElementById(id)
    if (!el) return
    const w = window.open('', '_blank', 'width=420,height=520')
    if (!w) return
    w.document.write(
      `<html><head><title>${code}</title><style>body{font-family:sans-serif;text-align:center;padding:16px}.h{font-weight:700;font-size:15px;margin-bottom:6px}.n{font-size:11px;margin-top:8px;border-top:1px solid #ccc;padding-top:6px}canvas,img{width:200px;height:200px}.t{font-weight:700;font-size:16px;margin-top:6px}.c{font-size:14px}</style></head><body>${el.innerHTML}</body></html>`,
    )
    // canvases don't survive innerHTML — copy them as images
    const src = el.querySelectorAll('canvas')
    w.document.querySelectorAll('canvas').forEach((c, i) => {
      const img = w.document.createElement('img')
      img.src = src[i].toDataURL()
      c.replaceWith(img)
    })
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }
  return (
    <Card size="small" title={heading ? tx('সদস্য কার্ড') : tx('QR লেবেল')} extra={<Button size="small" icon={<PrinterOutlined />} onClick={print}>{tx('প্রিন্ট')}</Button>} style={{ width: 240 }}>
      <div id={id} style={{ textAlign: 'center' }}>
        {heading && <div className="h" style={{ fontWeight: 600, marginBottom: 6 }}>{heading}</div>}
        <QRCode value={qrUrl(type, code)} size={160} bordered={false} style={{ margin: '0 auto' }} />
        <div className="t" style={{ fontWeight: 600 }}>{title}</div>
        <div className="c">{digits(code)}</div>
        {subtitle && <div className="c" style={{ color: '#888' }}>{subtitle}</div>}
        {note && <div className="n" style={{ fontSize: 11, marginTop: 8, borderTop: '1px solid #eee', paddingTop: 6 }}>{note}</div>}
      </div>
    </Card>
  )
}

type LabelProps = Parameters<typeof QrLabel>[0]

/** Compact "QR" button for page headers — shows the printable label in a popover. */
export function QrButton(props: LabelProps) {
  return (
    <Popover trigger="click" placement="bottomRight" content={<QrLabel {...props} />} styles={{ container: { padding: 0 } }}>
      <Button icon={<QrcodeOutlined />}>QR</Button>
    </Popover>
  )
}
