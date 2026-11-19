import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = (env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

  return {
    base: command === 'build' ? '/Sapthahacks2026/' : '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/health': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
    },
  };
});
