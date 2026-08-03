import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const apiPort = env.BOB_PORT || '5556'
  const allowedHosts = (
    env.BOB_UI_ALLOWED_HOSTS || 'localhost,127.0.0.1'
  )
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.BOB_UI_HOST || '127.0.0.1',
      port: Number(env.BOB_UI_PORT || 5555),
      strictPort: true,
      allowedHosts,
      proxy: {
        '/api': {
          target: env.BOB_API_URL || `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
