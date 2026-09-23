import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import bnBD from 'antd/locale/bn_BD'
import dayjs from 'dayjs'
import 'dayjs/locale/bn'
import { AuthProvider } from './auth/AuthContext'
import App from './App'
import './index.css'

dayjs.locale('bn')

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={bnBD}
      theme={{
        token: {
          colorPrimary: '#1f7a4d',
          fontFamily: "'Hind Siliguri', system-ui, sans-serif",
          borderRadius: 6,
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
