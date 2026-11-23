import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.API_PORT || 1101);

/** 배포 주소 경로 (예: its.itket.com/pagefy/). 개발 서버는 localhost:1100/ 에서 그대로 연다 */
export const BASE_PATH = '/pagefy/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE_PATH : '/',
  plugins: [react()],
  server: {
    port: 1100,
    strictPort: true,
    // Claude API 호출은 API 키가 있는 서버(server/index.ts)에서만 한다 → /api 는 서버로 넘긴다
    proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true } },
  },
  worker: { format: 'es' },
}));
