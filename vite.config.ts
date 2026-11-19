import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.API_PROXY_TARGET

  return {
    plugins: [react()],
    // 늦게 불러오는 묶음을 개발 서버가 처음 만날 때 화면을 새로 고치지 않게 미리 준비한다
    optimizeDeps: { include: ['pdfjs-dist', 'react-markdown'] },
    server: {
      // 개발 서버의 /v1 요청을 API 서버로 전달한다
      proxy: apiTarget ? { '/v1': { target: apiTarget } } : undefined,
    },
  }
})
