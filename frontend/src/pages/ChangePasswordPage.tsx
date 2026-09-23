import { Navigate, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Spin, Typography } from 'antd'
import { useAuth } from '../auth/AuthContext'
import PasswordForm from '../components/PasswordForm'

/** Forced first-login password change. */
export default function ChangePasswordPage() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading) return <Spin fullscreen />
  if (!user) return <Navigate to="/login" replace />
  if (!user.must_change_password) return <Navigate to="/" replace />

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 440 }}>
        <Typography.Title level={4}>নতুন পাসওয়ার্ড দিন</Typography.Title>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="নিরাপত্তার জন্য প্রথমবার লগইনের পর (বা অ্যাডমিন রিসেট করলে) পাসওয়ার্ড বদলানো বাধ্যতামূলক।"
        />
        <PasswordForm onDone={() => navigate('/', { replace: true })} />
        <Button type="link" style={{ padding: 0 }} onClick={() => logout().then(() => navigate('/login'))}>
          লগআউট
        </Button>
      </Card>
    </div>
  )
}
