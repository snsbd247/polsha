import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import bnBD from 'antd/locale/bn_BD'
import enUS from 'antd/locale/en_US'
import dayjs from 'dayjs'
import 'dayjs/locale/bn'
import { lang, t as tx } from './lib/i18n'
import { DEFAULT_BRAND, usePublicSettings } from './lib/settings'
import { AuthProvider } from './auth/AuthContext'
import App from './App'
import './index.css'

dayjs.locale(lang === 'en' ? 'en' : 'bn')
document.documentElement.lang = lang
document.title = tx('সমবায় ERP')

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

/** The society's brand colour (Branding settings) drives buttons, links and highlights. */
function Themed({ children }: { children: ReactNode }) {
  const { data } = usePublicSettings()
  return (
    <ConfigProvider
      locale={lang === 'en' ? enUS : bnBD}
      theme={{
        token: {
          colorPrimary: data?.brand_color || DEFAULT_BRAND,
          fontFamily: "'Inter', 'Hind Siliguri', system-ui, sans-serif",
          borderRadius: 6,
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Themed>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </Themed>
    </QueryClientProvider>
  </StrictMode>,
)
