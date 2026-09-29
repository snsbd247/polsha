import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than our pages: in chunks of their own
        // they stay in the browser cache across deploys.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
})
