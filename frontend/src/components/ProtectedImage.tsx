import { useEffect, useState } from 'react'
import { Avatar } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { api } from '../lib/api'

/** Photo served from an authenticated endpoint (img tags can't send the bearer token). */
export default function ProtectedImage({ url, size = 64, shape = 'square' }: { url: string | null; size?: number; shape?: 'square' | 'circle' }) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    if (!url) return
    let objectUrl: string | undefined
    let cancelled = false
    api
      .get(url, { baseURL: '', responseType: 'blob' })
      .then((r) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(r.data)
        setSrc(objectUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return <Avatar size={size} shape={shape} src={url ? src : undefined} icon={<UserOutlined />} />
}
